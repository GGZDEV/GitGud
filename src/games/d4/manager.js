// Module Diablo IV : personnages (chacun avec son build, son équipement et son dernier scan),
// builds importés, calibrage de l'inventaire, scan automatique, évaluation de chaque objet
// survolé, verdict au survol des compétences et du Parangon. État : userData/d4/state.json.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { D4Bridge } = require("./bridge");
const { getDict } = require("./data");
const { AffixMatcher } = require("./affixes");
const { parseItem } = require("./item");
const { evaluate } = require("./evaluate");
const { importBuild, refreshBuildKeys, emptyBuild } = require("./build-import");
const { parseTooltip, judge, classOfSkill } = require("./planner");

const INV_COLS = 11;
const INV_ROWS = 3;
const EQUIP_SLOTS = ["helm", "chest-armor", "gloves", "pants", "boots", "weapon", "offhand", "amulet", "ring-1", "ring-2"];

class D4Manager extends EventEmitter {
  constructor(dataDir) {
    super();
    this.file = path.join(dataDir, "d4", "state.json");
    this.dataDir = dataDir;
    this.state = { builds: [], characters: [], activeCharacterId: null, positions: { inventory: null, equip: {} }, lastItem: null };
    try {
      Object.assign(this.state, JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch {}
    // Ancien format (un seul build) → liste de builds
    if (this.state.build) {
      this.state.builds = [{ ...this.state.build, id: "b1", variantId: this.state.variantId }];
      this.state.activeBuildId = "b1";
      delete this.state.build;
      delete this.state.variantId;
    }
    // Avant les personnages : build actif, équipement et scan deviennent ceux d'un premier personnage
    if (!this.state.characters?.length) {
      const first = this.state.builds.find((b) => b.id === this.state.activeBuildId) || this.state.builds[0];
      this.state.characters = [
        { id: "c1", name: null, className: first?.className || null, buildId: first?.id || null, equipped: this.state.equipped || {}, inventory: this.state.inventory || [] },
      ];
      this.state.activeCharacterId = "c1";
    }
    delete this.state.equipped;
    delete this.state.inventory;
    delete this.state.activeBuildId;
    this.matcher = null;
    this.mode = null; // null | "sync" | { calibrate: [...] } | "scan"
    this.scanTarget = null;
    this.bridge = new D4Bridge();
    this.bridge.on("status", (s, d) => this.emit("status", s, d));
    this.bridge.on("tooltip", (t) => this.onTooltip(t).catch((e) => console.warn("D4 :", e.message)));
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }

  async ready() {
    if (!this.matcher) {
      this.matcher = new AffixMatcher(await getDict(this.dataDir));
      // Builds importés avec une version précédente : familles d'affixes à jour, puis réévaluation
      for (const b of this.state.builds) refreshBuildKeys(b, this.matcher);
      for (const c of this.state.characters) {
        for (const [slot, it] of Object.entries(c.equipped)) {
          // Infobulles de compétence / Parangon prises pour des objets par les versions précédentes
          if (/^(RANG|RANK|NIVEAU|LEVEL)\s+\d+|^MODIFICATEURS$|^GLYPHE/i.test(it.name || "")) delete c.equipped[slot];
          else this.reparse(it);
        }
      }
      this.reevaluate();
      this.refreshPlans();
    }
    return this.matcher;
  }

  // Builds Mobalytics importés avant le verdict compétences / Parangon : on récupère leur plan
  // (sans toucher aux priorités modifiées dans le panneau).
  async refreshPlans() {
    for (const b of this.state.builds.filter((x) => x.source === "mobalytics" && x.url && !x.variants.some((v) => v.plan))) {
      try {
        const fresh = await importBuild(b.url, this.matcher, this.matcher.dict);
        for (const v of b.variants) v.plan = fresh.variants.find((f) => f.id === v.id)?.plan || null;
        this.save();
        this.emit("plans");
      } catch (e) {
        console.warn("D4 plan :", e.message);
      }
    }
  }

  start() {
    this.bridge.start();
    this.ready().catch((e) => console.warn("D4 dictionnaire :", e.message));
  }

  // ---------- Personnages : chacun suit un build et garde son équipement ----------

  get char() {
    return this.state.characters.find((c) => c.id === this.state.activeCharacterId) || this.state.characters[0];
  }

  get equipped() {
    return this.char.equipped;
  }

  charLabel(c = this.char) {
    return c.name || c.className || "Personnage";
  }

  addCharacter({ name, className } = {}) {
    const c = { id: `c${Date.now()}`, name: name?.trim() || null, className: className || null, buildId: null, equipped: {}, inventory: [] };
    this.state.characters.push(c);
    this.state.activeCharacterId = c.id;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  setActiveCharacter(id) {
    if (this.state.characters.some((c) => c.id === id)) this.state.activeCharacterId = id;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  updateCharacter(id, patch) {
    const c = this.state.characters.find((x) => x.id === id);
    if (c) {
      if (patch.name !== undefined) c.name = patch.name.trim() || null;
      if (patch.className !== undefined) c.className = patch.className || null;
    }
    this.save();
    return this.summary();
  }

  deleteCharacter(id) {
    if (this.state.characters.length <= 1) return this.summary();
    this.state.characters = this.state.characters.filter((c) => c.id !== id);
    if (this.state.activeCharacterId === id) this.state.activeCharacterId = this.state.characters[0].id;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  // Fiche de personnage ouverte dans le jeu : bascule sur ce personnage (ou le crée)
  onCharacterSeen(name) {
    const known = this.state.characters.find((c) => c.name && c.name.toLowerCase() === name.toLowerCase());
    if (known) {
      if (known.id === this.char.id) return;
      this.state.activeCharacterId = known.id;
      this.reevaluate();
      this.save();
      return this.emit("character", { kind: "switched", name: this.charLabel(), build: this.build?.name || null });
    }
    // Premier personnage (issu de l'ancien format) pas encore nommé : c'est lui
    if (!this.char.name) {
      this.char.name = name;
      this.save();
      return this.emit("character", { kind: "named", name, build: this.build?.name || null });
    }
    this.addCharacter({ name });
    this.emit("character", { kind: "created", name });
  }

  // ---------- Builds : bibliothèque commune, un build suivi par personnage ----------

  get build() {
    return this.state.builds.find((b) => b.id === this.char.buildId) || null;
  }

  get variant() {
    const b = this.build;
    return b && (b.variants.find((v) => v.id === b.variantId) || b.variants[0]);
  }

  addBuild(build) {
    // Même lien déjà importé : on le remplace (mise à jour du guide)
    const existing = build.url && this.state.builds.find((b) => b.url === build.url);
    build.id = existing?.id || `b${Date.now()}`;
    const preferred = build.variants.find((v) => v.id === build.preferredVariant) || build.variants.find((v) => /end ?game|fin de jeu/i.test(v.name));
    build.variantId = existing?.variantId && build.variants.some((v) => v.id === existing.variantId) ? existing.variantId : (preferred || build.variants[0]).id;
    if (existing) this.state.builds[this.state.builds.indexOf(existing)] = build;
    else this.state.builds.push(build);
    this.char.buildId = build.id;
    if (!this.char.className && build.className) this.char.className = build.className;
    this.reevaluate();
    this.save();
    return build;
  }

  async importBuild(url) {
    const matcher = await this.ready();
    this.addBuild(await importBuild(url.trim(), matcher, this.matcher.dict));
    return this.summary();
  }

  newBuild(name, className) {
    this.addBuild(emptyBuild(name, className));
    return this.summary();
  }

  setActiveBuild(id) {
    const b = this.state.builds.find((x) => x.id === id);
    if (b) {
      this.char.buildId = id;
      if (!this.char.className && b.className) this.char.className = b.className;
    }
    this.reevaluate();
    this.save();
    return this.summary();
  }

  deleteBuild(id) {
    this.state.builds = this.state.builds.filter((b) => b.id !== id);
    for (const c of this.state.characters) if (c.buildId === id) c.buildId = null;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  renameBuild(id, name) {
    const b = this.state.builds.find((x) => x.id === id);
    if (b && name.trim()) b.name = name.trim();
    this.save();
    return this.summary();
  }

  setVariant(id) {
    const b = this.build;
    if (b) b.variantId = id;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  // Variante modifiée dans le panneau (priorités, affixes ajoutés / retirés, cible)
  async saveVariant(buildId, variant) {
    const matcher = await this.ready();
    const b = this.state.builds.find((x) => x.id === buildId);
    if (!b) throw new Error("Build introuvable.");
    for (const slot of variant.slots) {
      for (const a of [...slot.affixes, ...slot.tempering]) {
        if (a.manual && !a.keys?.length) Object.assign(a, matcher.familyOfKey(a.key));
      }
    }
    b.variants = b.variants.map((v) => (v.id === variant.id ? variant : v));
    b.edited = true;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  // Vue « équipement » du panneau : par emplacement, ce que vise le build et ce que tu portes
  equipmentView() {
    const v = this.variant;
    if (!v) return [];
    const rows = [];
    for (const target of v.slots.filter((s) => !/charm|seal|power|talisman/i.test(s.slot))) {
      const equippedKey = target.slot.startsWith("weapon") ? "weapon" : target.slot;
      const item = this.equipped[equippedKey] || null;
      const ev = item ? evaluate({ ...item, slot: item.slot === "ring" ? "ring" : item.slot }, { ...v, slots: [target] }, {}) : null;
      rows.push({
        slot: target.slot,
        slotName: target.slotName,
        target: target.titleFr || target.title,
        wanted: target.affixes.map((a) => (a.greater ? "★" : "") + a.label),
        item: item && { name: item.name, typeLine: item.typeLine, power: item.power },
        verdict: ev?.verdict || null,
        checks: ev?.checks || [],
        aspect: ev?.aspect || null,
        missing: ev?.missing || target.affixes.map((a) => (a.greater ? "★" : "") + a.label),
      });
    }
    return rows;
  }

  inventoryView() {
    return this.char.inventory.filter((c) => c.item).map((c) => ({ row: c.row, col: c.col, name: c.item.name, slotName: c.eval?.slotName, verdict: c.eval?.verdict }));
  }

  // Liste des caractéristiques pour l'ajout manuel d'un affixe
  async affixChoices() {
    return (await this.ready()).allLabels();
  }

  // Relit un objet mémorisé avec les règles de lecture actuelles (texte brut, ou reconstitué
  // pour les objets enregistrés par une version plus ancienne).
  reparse(it) {
    const lines = it.lines || [
      it.name, it.typeLine, it.power != null ? `${it.power} Puissance de l'objet` : "",
      ...(it.implicits || []).map((a) => a.text), ...(it.affixes || []).map((a) => a.text),
      it.power_text || "", ...(it.tempered || []).map((a) => a.text),
    ].filter(Boolean);
    const fresh = parseItem(lines, this.matcher);
    if (fresh) Object.assign(it, fresh, { slot: fresh.slot || it.slot });
  }

  // Réévalue l'inventaire mémorisé (changement de build ou de variante)
  reevaluate() {
    for (const cell of this.char.inventory) cell.eval = cell.item ? evaluate(cell.item, this.variant, this.equipped) : null;
  }

  summary() {
    const b = this.build;
    return {
      status: this.bridge.status,
      characters: this.state.characters.map((c) => ({
        id: c.id, name: c.name, label: this.charLabel(c), className: c.className, buildId: c.buildId,
        buildName: this.state.builds.find((x) => x.id === c.buildId)?.name || null, equippedCount: Object.keys(c.equipped).length,
      })),
      activeCharacterId: this.char.id,
      builds: this.state.builds.map((x) => ({ id: x.id, name: x.name, className: x.className, source: x.source, url: x.url, edited: !!x.edited, hasPlan: x.variants.some((v) => v.plan) })),
      activeBuildId: b?.id || null,
      build: b && { id: b.id, name: b.name, className: b.className, url: b.url, source: b.source, variants: b.variants.map((v) => ({ id: v.id, name: v.name })), variantId: this.variant?.id },
      variant: this.variant || null,
      equipped: Object.fromEntries(Object.entries(this.equipped).map(([k, it]) => [k, it.name])),
      calibrated: { inventory: !!this.state.positions.inventory, equip: Object.keys(this.state.positions.equip) },
    };
  }

  // ---------- Infobulles reçues du jeu ----------

  async onTooltip({ lines, raw, isItem, at }) {
    // Compétences, Parangon, fiche de personnage : reconnus avant les objets
    const t = parseTooltip(raw || lines);
    if (t) return this.onPlanTooltip(t);
    if (!isItem) return this.recordLive(lines, at);
    this.logTooltip(lines, at);
    const matcher = await this.ready();
    const item = parseItem(lines, matcher);
    if (!item?.slot || item.slot === "rune") return;
    const cursor = this.cursorPhysical();

    if (this.mode === "scan" && this.scanTarget) {
      this.scanTarget.item = item;
      return;
    }
    if (this.mode === "sync" && !item.hasComparison) {
      this.recordEquipped(item, cursor);
      return;
    }
    // Pas de comparaison = pièce portée : enregistrée au simple survol, sans synchronisation
    if (!item.hasComparison) {
      this.recordEquipped(item, cursor, true);
      this.emit("equipped", item);
    }

    this.state.lastItem = item;
    const ev = evaluate(item, this.variant, this.equipped);
    this.emit("item", { item, eval: ev });
  }

  // Survol d'une compétence, d'un modificateur, d'un nœud ou d'une châsse de Parangon
  async onPlanTooltip(t) {
    if (t.kind === "character") return this.onCharacterSeen(t.name);
    const dict = (await this.ready()).dict;
    if (t.kind === "skill") {
      // Compétence d'une autre classe que celle du personnage suivi
      const cls = classOfSkill(t.name, dict);
      if (cls && !this.char.className) {
        this.char.className = cls.en;
        this.save();
      } else if (cls && this.char.className && cls.en !== this.char.className && Date.now() - (this.mismatchAt || 0) > 60000) {
        this.mismatchAt = Date.now();
        this.emit("character", { kind: "mismatch", name: this.charLabel(), className: cls.fr });
      }
    }
    const plan = this.variant?.plan;
    if (!plan) {
      if (Date.now() - (this.noPlanAt || 0) > 60000) {
        this.noPlanAt = Date.now();
        const sub = this.build ? "Réimporte-le depuis Mobalytics (panneau Diablo IV)" : `Associe un build à ${this.charLabel()} (panneau Diablo IV)`;
        this.emit("hint", { level: "neutral", text: "· Compétences et Parangon inconnus", sub, cursor: this.cursorPhysical() });
      }
      return;
    }
    const verdict = judge(t, plan, dict);
    if (verdict) this.emit("hint", { ...verdict, cursor: this.cursorPhysical() });
  }

  // Objet porté (sans section « propriétés perdues ») : mémorise l'objet et la position de son emplacement
  recordEquipped(item, cursor, silent = false) {
    let slot = item.slot;
    if (slot === "ring") {
      const known = this.state.positions.equip;
      const near = ["ring-1", "ring-2"].find((s) => known[s] && dist(known[s], cursor) < 40);
      slot = near || (!known["ring-1"] ? "ring-1" : !known["ring-2"] ? "ring-2" : "ring-1");
      // Anneau 1 = celui de gauche
      if (!near && known["ring-1"] && slot === "ring-2" && cursor.x < known["ring-1"].x) {
        this.swapRings();
      }
    }
    this.equipped[slot] = item;
    this.state.positions.equip[slot] = cursor;
    this.save();
    if (!silent) this.emit("sync", { slot, item, done: this.syncedSlots() });
  }

  swapRings() {
    const { equipped: e, positions: p } = this.state;
    [e["ring-1"], e["ring-2"]] = [e["ring-2"], e["ring-1"]];
    [p.equip["ring-1"], p.equip["ring-2"]] = [p.equip["ring-2"], p.equip["ring-1"]];
  }

  syncedSlots() {
    return EQUIP_SLOTS.filter((s) => this.equipped[s]);
  }

  isNearEquipSlot(cursor) {
    return Object.values(this.state.positions.equip).some((p) => dist(p, cursor) < 40);
  }

  // ---------- Synchronisation et calibrage ----------

  startSync() {
    this.mode = "sync";
    this.emit("sync", { slot: null, done: this.syncedSlots() });
  }

  stopSync() {
    if (this.mode === "sync") this.mode = null;
  }

  // Calibrage de l'inventaire : 2 appuis sur la touche de scan (case en haut à gauche, puis en bas à droite)
  startCalibration() {
    this.mode = { calibrate: [] };
    this.emit("calibrate", { step: 0 });
  }

  calibrationPoint() {
    const pts = this.mode.calibrate;
    pts.push(this.cursorPhysical());
    if (pts.length < 2) return this.emit("calibrate", { step: 1 });
    const [tl, br] = pts;
    this.state.positions.inventory = { tl, br };
    this.mode = null;
    this.save();
    this.emit("calibrate", { step: 2, cells: this.inventoryCells() });
  }

  inventoryCells() {
    const inv = this.state.positions.inventory;
    if (!inv) return [];
    const cells = [];
    const dx = INV_COLS > 1 ? (inv.br.x - inv.tl.x) / (INV_COLS - 1) : 0;
    const dy = INV_ROWS > 1 ? (inv.br.y - inv.tl.y) / (INV_ROWS - 1) : 0;
    for (let r = 0; r < INV_ROWS; r++) for (let c = 0; c < INV_COLS; c++) cells.push({ row: r, col: c, x: inv.tl.x + c * dx, y: inv.tl.y + r * dy });
    return cells;
  }

  // ---------- Scan automatique (équipement puis inventaire) ----------

  async scan({ includeEquipped = true } = {}) {
    const { glideTo, cursor, sleep } = require("./mouse");
    if (!this.state.positions.inventory) throw new Error("Inventaire non calibré.");
    if (this.mode === "scan") return this.abortScan();
    this.mode = "scan";
    this.aborted = false;
    const origin = cursor();
    const equipTargets = includeEquipped ? Object.entries(this.state.positions.equip).map(([slot, p]) => ({ slot, ...p })) : [];
    const cells = this.inventoryCells();
    const results = [];
    this.emit("scan", { phase: "start", total: equipTargets.length + cells.length });
    let drift = 0;
    try {
      for (const target of [...equipTargets, ...cells]) {
        if (this.aborted) break;
        this.scanTarget = { item: null };
        const at = await glideTo(target.x, target.y);
        // Souris bougée par le joueur pendant le scan : on arrête (deux écarts de suite, pour
        // ne pas s'arrêter si le jeu recentre une fois le curseur).
        if (dist(at, target) > 40) {
          drift++;
          if (drift >= 2) {
            this.aborted = true;
            break;
          }
          continue;
        }
        drift = 0;
        await sleep(170);
        if (!this.scanTarget.item) await sleep(130); // infobulle lente : on laisse un peu plus de temps
        const item = this.scanTarget.item;
        if (target.slot) {
          if (item) this.equipped[target.slot] = item;
        } else {
          results.push({ row: target.row, col: target.col, x: target.x, y: target.y, item });
        }
        this.emit("scan", { phase: "progress", done: results.length + (target.slot ? 0 : 0) });
      }
    } finally {
      this.scanTarget = null;
      this.mode = null;
      await glideTo(origin.x, origin.y).catch(() => {});
    }
    if (!this.aborted) {
      this.char.inventory = results;
      this.reevaluate();
      this.save();
    }
    const evaluated = this.char.inventory.map((c) => ({ ...c, eval: c.eval }));
    this.emit("scan", { phase: this.aborted ? "aborted" : "done", cells: evaluated });
    return evaluated;
  }

  abortScan() {
    this.aborted = true;
  }

  // Curseur en pixels physiques (le main fournit la conversion via setCursorProvider)
  cursorPhysical() {
    return this.cursorProvider ? this.cursorProvider() : { x: 0, y: 0 };
  }

  setCursorProvider(fn) {
    this.cursorProvider = fn;
  }

  // Journal des 40 dernières infobulles d'objets reçues (texte brut), pour diagnostiquer
  // une fiche erronée : userData/d4/tooltips-log.json
  logTooltip(lines, at = Date.now()) {
    this.tooltipLog = [...(this.tooltipLog || []), { at, lines }].slice(-40);
    clearTimeout(this.logTimer);
    this.logTimer = setTimeout(() => {
      try {
        fs.writeFileSync(path.join(path.dirname(this.file), "tooltips-log.json"), JSON.stringify(this.tooltipLog, null, 1));
      } catch {}
    }, 2000);
  }

  // ---------- Ce que le jeu annonce (cibles, objectifs, ressources) ----------

  recordLive(lines, at = Date.now()) {
    this.live = (this.live || []).filter((l) => at - l.at < 120000);
    for (const text of lines) {
      if (/^(bouton (gauche|droit) de la souris|interagir|[a-z])$/i.test(text)) continue;
      const res = text.match(/^(Vigueur|Barrière|Esprit|Fureur|Mana|Énergie|Essence|Foi|Colère|Domination)\s*:?\s*(\d+)\s*%$/);
      if (res) {
        this.resources = { ...(this.resources || {}), [res[1]]: Number(res[2]) };
        continue;
      }
      this.live = this.live.filter((l) => l.text !== text);
      this.live.push({ text, at });
    }
    this.live = this.live.slice(-25);
  }

  liveContext() {
    const recent = (this.live || []).filter((l) => Date.now() - l.at < 120000);
    if (!recent.length) return "";
    const objectives = recent.filter((l) => /[.:]/.test(l.text) && l.text.length > 18).map((l) => l.text);
    const names = recent.filter((l) => !objectives.includes(l.text)).map((l) => l.text);
    const res = Object.entries(this.resources || {}).map(([k, v]) => `${k} ${v} %`).join(", ");
    return [
      "\nCe que le jeu a affiché ces 2 dernières minutes (lecteur d'écran) :",
      objectives.length ? `- Objectifs et messages : ${objectives.slice(-6).join(" | ")}` : "",
      names.length ? `- Ennemis / éléments ciblés récemment : ${names.slice(-12).join(", ")}` : "",
      res ? `- Ressources : ${res}` : "",
    ].filter(Boolean).join("\n");
  }

  // ---------- Contexte pour l'IA ----------

  context(question) {
    const v = this.variant;
    const b = this.build;
    const out = [];
    out.push(`Personnage suivi : ${this.charLabel()}${this.char.className ? ` (${this.char.className})` : ""}`);
    if (b && v) {
      out.push(`Build visé : « ${b.name} » (${b.className || "?"}), variante ${v.name}, importé de ${b.url}`);
      for (const s of v.slots.filter((s) => s.affixes.length)) {
        out.push(`- ${s.slotName} : ${s.title}${s.titleFr ? ` (${s.titleFr})` : ""} ; affixes ${s.affixes.map((a) => (a.greater ? "★" : "") + a.label).join(", ")}${s.tempering.length ? ` ; trempes ${s.tempering.map((t) => t.label).join(", ")}` : ""}${s.gems.length ? ` ; gemmes ${s.gems.join(", ")}` : ""}`);
      }
      if (v.plan?.skills.length) out.push(`- Compétences (rang visé ; modificateurs) : ${v.plan.skills.map((s) => `${s.fr} ${s.rank} (${s.mods.map((m) => m.fr).join(", ")})`).join(" ; ")}`);
      else if (v.skills.length) out.push(`- Compétences : ${v.skills.join(", ")}`);
      if (v.plan?.paragon.rares.length) {
        const nodes = [...new Set([...v.plan.paragon.legendaries, ...v.plan.paragon.rares].map((n) => n.fr))];
        out.push(`- Parangon, nœuds rares / légendaires visés : ${nodes.join(", ")} ; glyphes : ${v.plan.paragon.glyphs.map((g) => g.fr).join(", ")}`);
      }
      if (v.paragon.length) out.push(`- Parangon : ${v.paragon.map((p) => `${p.board}${p.glyph ? ` (glyphe ${p.glyph} niv. ${p.glyphLevel})` : ""}`).join(", ")}`);
    } else {
      out.push("Aucun build importé (le joueur peut en importer un dans Paramètres → Jeux).");
    }
    const eq = Object.entries(this.equipped);
    if (eq.length && v) {
      out.push("\nÉquipement porté (lu dans le jeu) :");
      for (const [slot, it] of eq) {
        const ev = evaluate({ ...it, slot: slot.startsWith("ring") ? "ring" : it.slot }, v, {});
        out.push(`- ${slot} : ${it.name} (${it.typeLine}, ${it.power ?? "?"}) — ${it.affixes.map((a) => a.text).join(" | ")}${it.power_text ? ` — pouvoir : ${it.power_text}` : ""}${ev ? ` → ${ev.wantedCount}/${ev.total} affixes du build${ev.missing.length ? `, manque ${ev.missing.join(", ")}` : ""}` : ""}`);
      }
    }
    const last = this.state.lastItem;
    if (last && /\b(ce|cet|cette|celui|celle|l'objet|item|loot|garde|prendre|equipe)/i.test(question)) {
      const ev = evaluate(last, v, this.equipped);
      out.push(`\nDernier objet survolé : ${last.name} (${last.typeLine}, ${last.power ?? "?"}) — ${last.affixes.map((a) => a.text).join(" | ")}${last.power_text ? ` — pouvoir : ${last.power_text}` : ""}${ev ? ` → verdict local : ${ev.verdict.text}` : ""}`);
    }
    const inv = this.char.inventory.filter((c) => c.item && c.eval && c.eval.verdict.level !== "bad");
    if (inv.length) out.push(`\nInventaire scanné, objets intéressants : ${inv.map((c) => `${c.item.name} (${c.eval.slotName}, ${c.eval.verdict.text})`).join(" ; ")}`);
    out.push(this.liveContext());
    return out.filter(Boolean).join("\n");
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

module.exports = { D4Manager, EQUIP_SLOTS };
