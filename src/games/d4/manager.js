// Module Diablo IV : build importé, équipement porté, calibrage de l'inventaire, scan
// automatique, évaluation de chaque objet survolé. État conservé dans userData/d4/state.json.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { D4Bridge } = require("./bridge");
const { getDict } = require("./data");
const { AffixMatcher } = require("./affixes");
const { parseItem } = require("./item");
const { evaluate } = require("./evaluate");
const { importBuild, refreshBuildKeys, emptyBuild } = require("./build-import");

const INV_COLS = 11;
const INV_ROWS = 3;
const EQUIP_SLOTS = ["helm", "chest-armor", "gloves", "pants", "boots", "weapon", "offhand", "amulet", "ring-1", "ring-2"];

class D4Manager extends EventEmitter {
  constructor(dataDir) {
    super();
    this.file = path.join(dataDir, "d4", "state.json");
    this.dataDir = dataDir;
    this.state = { builds: [], activeBuildId: null, equipped: {}, positions: { inventory: null, equip: {} }, inventory: [], lastItem: null };
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
      for (const it of Object.values(this.state.equipped)) this.reparse(it);
      this.reevaluate();
    }
    return this.matcher;
  }

  start() {
    this.bridge.start();
    this.ready().catch((e) => console.warn("D4 dictionnaire :", e.message));
  }

  // ---------- Builds : plusieurs builds enregistrés, un actif ----------

  get build() {
    return this.state.builds.find((b) => b.id === this.state.activeBuildId) || this.state.builds[0] || null;
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
    this.state.activeBuildId = build.id;
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
    if (this.state.builds.some((b) => b.id === id)) this.state.activeBuildId = id;
    this.reevaluate();
    this.save();
    return this.summary();
  }

  deleteBuild(id) {
    this.state.builds = this.state.builds.filter((b) => b.id !== id);
    if (this.state.activeBuildId === id) this.state.activeBuildId = this.state.builds[0]?.id || null;
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
      const item = this.state.equipped[equippedKey] || null;
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
    return this.state.inventory.filter((c) => c.item).map((c) => ({ row: c.row, col: c.col, name: c.item.name, slotName: c.eval?.slotName, verdict: c.eval?.verdict }));
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
    for (const cell of this.state.inventory) cell.eval = cell.item ? evaluate(cell.item, this.variant, this.state.equipped) : null;
  }

  summary() {
    const b = this.build;
    return {
      status: this.bridge.status,
      builds: this.state.builds.map((x) => ({ id: x.id, name: x.name, className: x.className, source: x.source, url: x.url, edited: !!x.edited })),
      activeBuildId: b?.id || null,
      build: b && { id: b.id, name: b.name, className: b.className, url: b.url, source: b.source, variants: b.variants.map((v) => ({ id: v.id, name: v.name })), variantId: this.variant?.id },
      variant: this.variant || null,
      equipped: Object.fromEntries(Object.entries(this.state.equipped).map(([k, it]) => [k, it.name])),
      calibrated: { inventory: !!this.state.positions.inventory, equip: Object.keys(this.state.positions.equip) },
    };
  }

  // ---------- Infobulles reçues du jeu ----------

  async onTooltip({ lines, isItem, at }) {
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
    const ev = evaluate(item, this.variant, this.state.equipped);
    this.emit("item", { item, eval: ev });
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
    this.state.equipped[slot] = item;
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
    return EQUIP_SLOTS.filter((s) => this.state.equipped[s]);
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
          if (item) this.state.equipped[target.slot] = item;
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
      this.state.inventory = results;
      this.reevaluate();
      this.save();
    }
    const evaluated = this.state.inventory.map((c) => ({ ...c, eval: c.eval }));
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
    if (b && v) {
      out.push(`Build visé : « ${b.name} » (${b.className || "?"}), variante ${v.name}, importé de ${b.url}`);
      for (const s of v.slots.filter((s) => s.affixes.length)) {
        out.push(`- ${s.slotName} : ${s.title}${s.titleFr ? ` (${s.titleFr})` : ""} ; affixes ${s.affixes.map((a) => (a.greater ? "★" : "") + a.label).join(", ")}${s.tempering.length ? ` ; trempes ${s.tempering.map((t) => t.label).join(", ")}` : ""}${s.gems.length ? ` ; gemmes ${s.gems.join(", ")}` : ""}`);
      }
      if (v.skills.length) out.push(`- Compétences : ${v.skills.join(", ")}`);
      if (v.paragon.length) out.push(`- Parangon : ${v.paragon.map((p) => `${p.board}${p.glyph ? ` (glyphe ${p.glyph} niv. ${p.glyphLevel})` : ""}`).join(", ")}`);
    } else {
      out.push("Aucun build importé (le joueur peut en importer un dans Paramètres → Jeux).");
    }
    const eq = Object.entries(this.state.equipped);
    if (eq.length && v) {
      out.push("\nÉquipement porté (lu dans le jeu) :");
      for (const [slot, it] of eq) {
        const ev = evaluate({ ...it, slot: slot.startsWith("ring") ? "ring" : it.slot }, v, {});
        out.push(`- ${slot} : ${it.name} (${it.typeLine}, ${it.power ?? "?"}) — ${it.affixes.map((a) => a.text).join(" | ")}${it.power_text ? ` — pouvoir : ${it.power_text}` : ""}${ev ? ` → ${ev.wantedCount}/${ev.total} affixes du build${ev.missing.length ? `, manque ${ev.missing.join(", ")}` : ""}` : ""}`);
      }
    }
    const last = this.state.lastItem;
    if (last && /\b(ce|cet|cette|celui|celle|l'objet|item|loot|garde|prendre|equipe)/i.test(question)) {
      const ev = evaluate(last, v, this.state.equipped);
      out.push(`\nDernier objet survolé : ${last.name} (${last.typeLine}, ${last.power ?? "?"}) — ${last.affixes.map((a) => a.text).join(" | ")}${last.power_text ? ` — pouvoir : ${last.power_text}` : ""}${ev ? ` → verdict local : ${ev.verdict.text}` : ""}`);
    }
    const inv = this.state.inventory.filter((c) => c.item && c.eval && c.eval.verdict.level !== "bad");
    if (inv.length) out.push(`\nInventaire scanné, objets intéressants : ${inv.map((c) => `${c.item.name} (${c.eval.slotName}, ${c.eval.verdict.text})`).join(" ; ")}`);
    out.push(this.liveContext());
    return out.filter(Boolean).join("\n");
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

module.exports = { D4Manager, EQUIP_SLOTS };
