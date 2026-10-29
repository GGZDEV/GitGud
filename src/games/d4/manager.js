// Module Diablo IV : personnages (chacun avec son build, son équipement et son dernier scan),
// builds importés, calibrage de l'inventaire, scan automatique, évaluation de chaque objet
// survolé, verdict au survol des compétences et du Parangon. État : userData/d4/state.json.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { D4Bridge } = require("./bridge");
const { getDict } = require("./data");
const { AffixMatcher, clean } = require("./affixes");
const { parseItem } = require("./item");
const { evaluate, keepBestPerSlot, withDefaults } = require("./evaluate");
const { importBuild, refreshBuildKeys, emptyBuild, mainStatAffix } = require("./build-import");
const { parseTooltip, judge, classOfSkill } = require("./planner");

const INV_COLS = 11;
const INV_ROWS = 3;
const EQUIP_SLOTS = ["helm", "chest-armor", "gloves", "pants", "boots", "weapon", "offhand", "amulet", "ring-1", "ring-2"];
// Version des règles de mémorisation de l'équipement : les données enregistrées avant sont nettoyées
const EQUIP_RULES = 3;

// Emplacement mémorisé (« ring-1 ») → emplacement lu sur l'objet (« ring »)
// Les charmes sont plusieurs : « charm:<nom> »
const itemSlotOf = (key) => (/^ring/.test(key) ? "ring" : /^charm/.test(key) ? "charm" : key);
const MAX_CHARMS = 6;

// Textes d'autres fenêtres du jeu lus comme des objets (enchanteur, erreurs de traduction du jeu)
const JUNK_NAME = /no grammatical form|materiaux requis|required materials|^objet$|^item$/;

// Objet plausible pour un emplacement porté : bon type, une rareté, un vrai nom
function fitsSlot(item, key) {
  if (!item?.slot || item.slot !== itemSlotOf(key)) return false;
  if (JUNK_NAME.test(clean(item.name || ""))) return false;
  return !!(item.rarity || item.power);
}

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
    // Faux personnages créés par une détection trop large (« Le personnage inconnu ») : un nom de
    // personnage n'a jamais d'espace. On ne retire que ceux restés vides.
    this.state.characters = this.state.characters.filter(
      (c, i) => i === 0 || !/\s/.test(c.name || "") || c.buildId || Object.keys(c.equipped).length || c.inventory?.length,
    );
    if (!this.state.characters.some((c) => c.id === this.state.activeCharacterId)) this.state.activeCharacterId = this.state.characters[0].id;
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
      this.cleanEquipped();
      for (const c of this.state.characters) {
        for (const [slot, it] of Object.entries(c.equipped)) {
          // Infobulles de compétence / Parangon prises pour des objets par les versions précédentes
          if (/^(RANG|RANK|NIVEAU|LEVEL)\s+\d+|^MODIFICATEURS$|^GLYPHE/i.test(it.name || "")) delete c.equipped[slot];
          // Objet réservé à une autre classe, enregistré par erreur (survolé dans le coffre)
          else if (this.isForeign(it, c)) delete c.equipped[slot];
          else this.reparse(it);
        }
        // Dernier scan du sac : relu aussi (rareté, écarts avec la pièce portée…)
        for (const cell of c.inventory || []) if (cell.item) this.reparse(cell.item);
      }
      this.reevaluate();
      this.refreshPlans();
    }
    return this.matcher;
  }

  // Versions précédentes : chaque survol d'une pièce sans comparaison enregistrait la position de la
  // souris comme emplacement (même dans le coffre ou en jeu) et pouvait ranger un objet du sac dans
  // l'équipement. Positions remises à zéro (une synchronisation suffit à les retrouver) et objets
  // incohérents retirés : mauvais type, texte parasite, ou objet présent dans le sac.
  cleanEquipped() {
    const rules = this.state.equipRules || 0;
    if (rules >= EQUIP_RULES) return;
    if (rules < 2) this.state.positions.equip = {};
    for (const c of this.state.characters) {
      for (const [key, it] of Object.entries(c.equipped)) {
        this.reparse(it);
        if (!fitsSlot(it, key) || this.inBag(it, c)) delete c.equipped[key];
        // Un seul charme mémorisé auparavant : rangé avec les autres
        else if (key === "charm") {
          delete c.equipped.charm;
          c.equipped[`charm:${it.name}`] = it;
        }
      }
    }
    this.state.equipRules = EQUIP_RULES;
    this.save();
  }

  // Même objet (texte identique) que l'une des cases du dernier scan du sac
  inBag(item, c = this.char) {
    const sig = (it) => JSON.stringify((it.lines || []).slice(0, 10));
    return (c.inventory || []).some((cell) => cell.item && cell.item.name === item.name && sig(cell.item) === sig(item));
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

  // Bascule vers un autre personnage (détecté en jeu), et lui associe le build de sa classe s'il
  // n'en a pas et qu'un seul correspond.
  switchTo(c, reason) {
    if (!c || c.id === this.char.id) return false;
    this.state.activeCharacterId = c.id;
    if (!c.buildId && c.className) {
      const builds = this.state.builds.filter((b) => b.className === c.className);
      if (builds.length === 1) c.buildId = builds[0].id;
    }
    this.reevaluate();
    this.save();
    this.emit("character", { kind: "switched", name: this.charLabel(), build: this.build?.name || null, reason });
    return true;
  }

  // « Niveau 70 requisSacresprit. uniquement » / « (Voleur ou voleuse Sacresprit uniquement) » :
  // classe à laquelle l'objet est réservé (nom anglais), ou null.
  restrictedClass(item) {
    const classes = Object.values(this.matcher?.dict?.classes || {});
    for (const l of item.lines || []) {
      if (!/uniquement|\bonly\b/i.test(l)) continue;
      const hit = classes.find((c) => [c.fr, c.frFemale, c.en].some((n) => n && new RegExp(`${n}\\W*(uniquement|only)`, "i").test(l)));
      if (hit) return hit.en;
    }
    return null;
  }

  // Objet qu'un personnage ne peut pas porter (réservé à une autre classe)
  isForeign(item, c = this.char) {
    const cls = this.restrictedClass(item);
    return !!(cls && c.className && cls !== c.className);
  }

  // Pièce portée reconnue (même texte exact) dans l'équipement d'un autre personnage
  switchToWearer(item) {
    // Un objet d'une autre classe n'affiche jamais de comparaison (coffre, sac) : si la fiche
    // vient de confirmer le personnage joué, ce n'est pas une pièce portée.
    const sheet = this.sheetSeen;
    if (this.isForeign(item) && sheet?.id === this.char.id && Date.now() - sheet.at < 30 * 60000) return false;
    const same = (a, b) => a?.name === b.name && JSON.stringify(a.lines?.slice(0, 12)) === JSON.stringify(b.lines?.slice(0, 12));
    if (Object.values(this.equipped).some((it) => same(it, item))) return false;
    const owner = this.state.characters.find((c) => c.id !== this.char.id && Object.values(c.equipped || {}).some((it) => same(it, item)));
    return this.switchTo(owner, "equipped");
  }

  // Fiche de personnage ouverte dans le jeu : bascule sur ce personnage (ou le crée)
  onCharacterSeen(name) {
    const known = this.state.characters.find((c) => c.name && c.name.toLowerCase() === name.toLowerCase());
    if (known) this.sheetSeen = { id: known.id, at: Date.now() };
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
      this.sheetSeen = { id: this.char.id, at: Date.now() };
      this.save();
      return this.emit("character", { kind: "named", name, build: this.build?.name || null });
    }
    this.addCharacter({ name });
    this.sheetSeen = { id: this.char.id, at: Date.now() };
    this.emit("character", { kind: "created", name });
  }

  // ---------- Builds : bibliothèque commune, un build suivi par personnage ----------

  get build() {
    return this.state.builds.find((b) => b.id === this.char.buildId) || null;
  }

  // Variante telle qu'évaluée : les pièces sans priorité d'affixes (guides de montée de niveau)
  // reprennent celles du reste du build et la caractéristique principale de la classe.
  completed(build, variant) {
    if (!variant) return variant;
    const main = this.matcher && mainStatAffix(build?.className, this.matcher);
    return withDefaults(variant, build, main);
  }

  get evalVariant() {
    return this.completed(this.build, this.variant);
  }

  // Autres variantes du build (Endgame, Mythic… quand on suit le Starter) et builds des autres
  // personnages (le Sacresprit quand on joue le Démoniste) : un objet qu'ils recherchent est
  // signalé « à garder » au lieu de « à recycler ». Désactivable (main.js).
  otherVariants() {
    const b = this.build;
    const v = this.variant;
    if (this.laterVariants === false) return [];
    const out = b && v ? b.variants.filter((x) => x.id !== v.id).map((x) => ({ name: x.name, variant: this.completed(b, x) })) : [];
    for (const other of this.state.builds) {
      if (other.id === b?.id) continue;
      const ov = other.variants.find((x) => x.id === other.variantId) || other.variants[0];
      if (!ov) continue;
      const owner = this.state.characters.find((c) => c.buildId === other.id && c.id !== this.char.id);
      const cls = other.className || owner?.className || null;
      out.push({
        name: `${owner ? this.charLabel(owner) : other.className || "autre build"} · ${shortName(other.name)}`,
        variant: this.completed(other, ov),
        crossClass: !!(cls && this.char.className && cls !== this.char.className),
        otherBuild: true,
      });
    }
    return out;
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
      const full = this.evalVariant.slots.find((s) => s.slot === target.slot) || target;
      const ev = item ? evaluate({ ...item, slot: item.slot === "ring" ? "ring" : item.slot }, { ...v, slots: [full] }, {}) : null;
      rows.push({
        slot: target.slot,
        slotName: target.slotName,
        target: target.titleFr || target.title,
        wanted: full.affixes.map((a) => (a.greater ? "★" : "") + a.label),
        inferred: !!full.inferred,
        item: item && { name: item.name, typeLine: item.typeLine, power: item.power },
        verdict: ev?.verdict || null,
        checks: ev?.checks || [],
        aspect: ev?.aspect || null,
        missing: ev?.missing || full.affixes.map((a) => (a.greater ? "★" : "") + a.label),
        // Ce que visent les autres variantes pour cet emplacement, quand c'est différent
        later: this.otherVariants()
          .map(({ name, variant }) => ({ name, t: variant.slots.find((s) => s.slot === target.slot) }))
          .filter(({ t }) => t && ((t.titleFr || t.title) !== (target.titleFr || target.title) || t.affixes.map((a) => a.label).join() !== target.affixes.map((a) => a.label).join()))
          .map(({ name, t }) => ({ variant: name, target: t.titleFr || t.title, wanted: t.affixes.map((a) => (a.greater ? "★" : "") + a.label) })),
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
    const v = this.evalVariant;
    const others = this.otherVariants();
    for (const cell of this.char.inventory) cell.eval = cell.item ? evaluate(cell.item, v, this.equipped, others) : null;
    keepBestPerSlot(this.char.inventory);
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
    this.lastTooltipAt = Date.now();
    this.captureSheet(raw || lines);
    // Compétences, Parangon, fiche de personnage : reconnus avant les objets
    const t = parseTooltip(raw || lines);
    // Un objet survolé fiche de personnage ouverte reste un objet
    if (t && !(isItem && t.kind === "character")) return this.onPlanTooltip(t);
    if (!isItem) return this.recordLive(lines, at);
    this.logTooltip(lines, at);
    const matcher = await this.ready();
    const item = parseItem(lines, matcher);
    if (!item?.slot || item.slot === "rune") {
      // Fiche de personnage lue comme un survol d'objet, sans objet dedans : c'est bien la fiche
      if (t?.kind === "character") this.onCharacterSeen(t.name);
      return;
    }
    const cursor = this.cursorPhysical();

    if (this.mode === "scan" && this.scanTarget) {
      this.scanTarget.item = item;
      return;
    }
    if (this.mode === "sync" && !item.hasComparison) {
      this.recordEquipped(item, cursor);
      return;
    }
    // Pas de comparaison = pièce portée. Si c'est celle d'un autre personnage, c'est lui qu'on
    // joue : on bascule sans passer par le panneau.
    if (!item.hasComparison && !this.mode) this.switchToWearer(item);
    // Pièce portée : enregistrée au simple survol, sans synchronisation (jamais un objet que le
    // personnage ne peut pas porter : sans comparaison parce que réservé à une autre classe)
    if (!item.hasComparison && !this.isForeign(item)) {
      this.recordEquipped(item, cursor, true);
      this.emit("equipped", item);
    }

    this.state.lastItem = item;
    const ev = evaluate(item, this.evalVariant, this.equipped, this.otherVariants());
    this.emit("item", { item, eval: ev, variant: this.variant?.name || null });
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
      } else if (cls && this.char.className && cls.en !== this.char.className) {
        // Un seul personnage de cette classe : c'est lui qu'on joue
        const same = this.state.characters.filter((c) => c.className === cls.en);
        if (same.length === 1) this.switchTo(same[0], "skill");
        else if (Date.now() - (this.mismatchAt || 0) > 60000) {
          this.mismatchAt = Date.now();
          this.emit("character", { kind: "mismatch", name: this.charLabel(), className: cls.fr });
        }
      }
    }
    this.recordSeen(t);
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

  // Objet porté (sans section « propriétés perdues ») : mémorise l'objet. La position de son
  // emplacement n'est retenue que pendant la synchronisation (silent = false), quand on sait que le
  // joueur survole son équipement : un simple survol peut venir du coffre, d'un marchand, du sol…
  recordEquipped(item, cursor, silent = false) {
    let slot = item.slot;
    const known = this.state.positions.equip;
    if (slot === "ring") {
      if (silent) {
        // Sans position fiable : l'anneau du même nom, sinon un emplacement libre, sinon on ne sait pas
        slot = ["ring-1", "ring-2"].find((s) => this.equipped[s]?.name === item.name) || ["ring-1", "ring-2"].find((s) => !this.equipped[s]);
        if (!slot) return;
      } else {
        const near = ["ring-1", "ring-2"].find((s) => known[s] && dist(known[s], cursor) < 40);
        slot = near || (!known["ring-1"] ? "ring-1" : !known["ring-2"] ? "ring-2" : "ring-1");
        // Anneau 1 = celui de gauche
        if (!near && known["ring-1"] && slot === "ring-2" && cursor.x < known["ring-1"].x) {
          this.swapRings();
        }
      }
    }
    if (slot === "charm") slot = `charm:${item.name}`;
    if (!fitsSlot(item, slot) || this.inBag(item)) return;
    item.seenAt = Date.now();
    this.equipped[slot] = item;
    // Charmes : les plus récemment vus portés, autant que d'emplacements
    const charms = Object.keys(this.equipped).filter((k) => /^charm/.test(k));
    if (charms.length > MAX_CHARMS) {
      charms.sort((a, b) => (this.equipped[a].seenAt || 0) - (this.equipped[b].seenAt || 0));
      for (const k of charms.slice(0, charms.length - MAX_CHARMS)) delete this.equipped[k];
    }
    if (!silent && !this.inInventoryGrid(cursor)) known[slot] = cursor;
    this.save();
    if (!silent) this.emit("sync", { slot, item, done: this.syncedSlots() });
  }

  // Curseur sur la grille du sac (calibrée) : jamais un emplacement d'équipement
  inInventoryGrid(p) {
    const inv = this.state.positions.inventory;
    if (!inv || !p) return false;
    const m = 30;
    return p.x > Math.min(inv.tl.x, inv.br.x) - m && p.x < Math.max(inv.tl.x, inv.br.x) + m && p.y > Math.min(inv.tl.y, inv.br.y) - m && p.y < Math.max(inv.tl.y, inv.br.y) + m;
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
    // Emplacements retenus pendant une synchronisation, hors de la grille du sac
    const equipTargets = includeEquipped
      ? Object.entries(this.state.positions.equip).filter(([, p]) => !this.inInventoryGrid(p)).map(([slot, p]) => ({ slot, ...p }))
      : [];
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
          // Une pièce portée n'a pas de comparaison et correspond à l'emplacement
          if (item && !item.hasComparison && fitsSlot(item, target.slot)) this.equipped[target.slot] = item;
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
      // Un objet du sac n'est pas porté (comparaison masquée avec Maj lors d'un survol précédent)
      for (const [key, it] of Object.entries(this.equipped)) if (this.inBag(it)) delete this.equipped[key];
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

  // ---------- Ce que le personnage a réellement (fiche, compétences, glyphes) ----------

  // Fiche de personnage : le jeu l'ajoute aux infobulles quand elle est ouverte (« Dégâts des
  // armes : 3 454 », « Force : 217 (apport des objets : 14)… », robustesse par type de dégâts).
  captureSheet(lines) {
    if (!lines?.some((l) => SHEET_HINT.test(l))) return;
    const sheet = { ...(this.char.sheet || {}), at: Date.now() };
    const stats = { ...(sheet.stats || {}) };
    lines.forEach((raw, i) => {
      const l = raw.replace(/[  ]/g, " ").trim();
      let m = l.match(/^(Dégâts des armes|Weapon Damage)\s*:\s*([\d ,.]+)/i);
      if (m) return (sheet.weaponDamage = sheetNum(m[2]));
      if (/robustesse est une estimation|toughness is an estimate/i.test(l)) {
        sheet.toughness = {};
        for (const [, k, v] of l.matchAll(/(Physique|Feu|Froid|Foudre|Poison|Ombres|Armure|Maximum de points de vie|Physical|Fire|Cold|Lightning|Shadow|Armor|Maximum Life)\s*:\s*([\d ,.]+)/gi)) sheet.toughness[k] = sheetNum(v);
        return;
      }
      m = l.match(/^(Force|Intelligence|Volonté|Dextérité|Strength|Willpower|Dexterity)\s*:\s*([\d ,.]+)/i);
      if (m) return (stats[m[1]] = sheetNum(m[2]));
      // Libellé suivi de sa valeur sur la ligne d'après (« Résistance au poison », « 3 447 »)
      const next = (lines[i + 1] || "").replace(/[  ]/g, " ").trim();
      if (l.length < 45 && /^[A-ZÀ-Ý]/.test(l) && !/[:.]/.test(l) && /^\d[\d ]*([,.]\d+)?\s*%?$/.test(next)) stats[l] = next;
    });
    sheet.stats = stats;
    this.char.sheet = sheet;
    this.saveSoon();
  }

  // Compétences, modificateurs et glyphes survolés : ce que le personnage a vraiment
  recordSeen(t) {
    const c = this.char;
    const seen = (c.seen ||= { skills: {}, mods: {}, glyphs: {}, nodes: {} });
    const at = Date.now();
    if (t.kind === "skill" && t.name) seen.skills[t.name] = { rank: t.rank, max: t.max, learned: t.learned, at };
    else if (t.kind === "mod" && t.name) seen.mods[t.name] = { learned: t.learned, at };
    else if (t.kind === "socket" && t.glyph) seen.glyphs[t.glyph] = { at };
    else if (t.kind === "node" && t.name) seen.nodes[t.name] = { rarity: t.rarity, allocated: t.allocated, at };
    else return;
    this.saveSoon();
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  // ---------- Ce que le jeu annonce (cibles, objectifs, ressources) ----------

  // Ressource lue par le lecteur d'écran (« Vigueur : 80 % ») : elle trahit la classe jouée. Chaque
  // personnage retient la sienne quand sa fiche vient de le confirmer ; les ressources connues de
  // chaque classe servent avant cela. Bascule s'il n'y a qu'un candidat.
  onResourceSeen(resource) {
    const known = (c) => c.resource || CLASS_RESOURCE[c.className] || null;
    // Apprise seulement si elle n'est celle d'aucun autre personnage ni contraire à la classe (sinon
    // c'est qu'on a changé de personnage depuis la fiche)
    const sheet = this.sheetSeen;
    const learnable = !this.char.resource && !CLASS_RESOURCE[this.char.className] && !this.state.characters.some((c) => c.id !== this.char.id && known(c) === resource);
    if (learnable && sheet?.id === this.char.id && Date.now() - sheet.at < 30 * 60000) {
      this.char.resource = resource;
      this.save();
    }
    if (known(this.char) === resource) return;
    if (known(this.char) === null && !this.state.characters.some((c) => c.id !== this.char.id && known(c) === resource)) return;
    let candidates = this.state.characters.filter((c) => known(c) === resource);
    if (!candidates.length) candidates = this.state.characters.filter((c) => c.id !== this.char.id && known(c) === null);
    if (candidates.length === 1) this.switchTo(candidates[0], "resource");
  }

  // Nom d'un de tes personnages lu seul à l'écran (sélection du personnage, fiche…) : c'est lui
  onNamesSeen(lines) {
    const own = this.state.characters.filter((c) => c.name && lines.some((l) => norm(l.trim()) === norm(c.name)));
    if (own.length === 1) this.switchTo(own[0], "name");
  }

  recordLive(lines, at = Date.now()) {
    this.onNamesSeen(lines);
    this.live = (this.live || []).filter((l) => at - l.at < 120000);
    for (const text of lines) {
      if (/^(bouton (gauche|droit) de la souris|interagir|[a-z])$/i.test(text)) continue;
      const res = text.match(/^(Vigueur|Barrière|Esprit|Fureur|Mana|Énergie|Essence|Foi|Colère|Domination)\s*:?\s*(\d+)\s*%$/);
      if (res) {
        this.resources = { ...(this.resources || {}), [res[1]]: Number(res[2]) };
        this.onResourceSeen(res[1]);
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

  // Build dont parle la question (« en Apocalypse… », « mon démoniste… », « AmorFati… ») parmi
  // les builds enregistrés, sinon null.
  buildNamedIn(question) {
    const q = norm(question);
    if (!q) return null;
    const classes = Object.values(this.matcher?.dict?.classes || {});
    const hits = this.state.builds.map((b) => {
      const owner = this.state.characters.find((c) => c.buildId === b.id);
      const cls = classes.find((c) => c.en === (b.className || owner?.className));
      const words = norm(b.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !classes.some((c) => norm(c.en) === w));
      const has = (w) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}`).test(q);
      let score = words.filter(has).length * 2;
      if (owner?.name && has(norm(owner.name))) score += 2;
      if (cls && [cls.fr, cls.frFemale, cls.en].some((n) => n && has(norm(n)))) score += 1;
      return { b, score };
    }).filter((h) => h.score > 0).sort((x, y) => y.score - x.score);
    return hits[0] && (!hits[1] || hits[1].score < hits[0].score) ? hits[0].b : null;
  }

  // Variante nommée dans la question (« en pushing », « speedfarm »), sinon celle suivie
  variantNamedIn(b, question) {
    const q = norm(question);
    return b.variants.find((v) => norm(v.name).length >= 4 && q.includes(norm(v.name))) || b.variants.find((v) => v.id === b.variantId) || b.variants[0];
  }

  buildLines(b, v) {
    const out = [];
    out.push(`Build visé : « ${b.name} » (${b.className || "?"}), variante ${v.name}${b.variants.length > 1 ? ` (autres variantes : ${b.variants.filter((x) => x.id !== v.id).map((x) => x.name).join(", ")})` : ""}${b.url ? `, importé de ${b.url}` : ""}`);
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
    return out;
  }

  context(question) {
    const out = [];
    // Le build nommé dans la question prime sur celui du personnage suivi : c'est de lui qu'on
    // parle, avec l'équipement du personnage qui le joue.
    const named = this.buildNamedIn(question);
    const b = named || this.build;
    const char = (named && this.state.characters.find((c) => c.buildId === named.id)) || (named ? null : this.char);
    const v = b && (named ? this.variantNamedIn(b, question) : this.variant);
    const evalV = b && v ? this.completed(b, v) : null;
    out.push(
      "Données Diablo IV lues dans le jeu par GitGud (personnage, build, équipement, compétences). Tu les as déjà : ne demande pas " +
        "au joueur son build, son lien ou son équipement. Appuie tes conseils sur ces données et sur la capture. S'il manque une " +
        "information utile, dis laquelle et comment la fournir (ex. survoler ses compétences, ouvrir sa fiche de personnage).",
    );
    out.push(`\nPersonnage joué : ${this.charLabel()}${this.char.className ? ` (${this.className(this.char.className)})` : ""}${this.build ? `, build suivi « ${this.build.name} », variante ${this.variant?.name}` : ", aucun build associé"}`);
    const others = this.state.characters.filter((c) => c.id !== this.char.id);
    if (others.length) out.push(`Autres personnages : ${others.map((c) => `${this.charLabel(c)}${c.className ? ` (${this.className(c.className)})` : ""}`).join(", ")}`);
    if (named && named.id !== this.build?.id) {
      out.push(`La question porte sur le build « ${named.name} »${char ? ` (personnage ${this.charLabel(char)})` : ""} : réponds avec ce build-là, ses données sont ci-dessous.`);
    }
    out.push(...this.sheetLines(char));
    if (b && v) out.push("", ...this.buildLines(b, v));
    else out.push("Aucun build importé (le joueur peut en importer un dans le panneau Diablo IV).");
    if (char && evalV) out.push(...this.gearLines(char, evalV));
    if (char) out.push(...this.seenLines(char, v));

    const last = this.state.lastItem;
    if (last && /\b(ce|cet|cette|celui|celle|l'objet|item|loot|garde|prendre|equipe)/i.test(question)) {
      const ev = evaluate(last, this.evalVariant, this.equipped, this.otherVariants());
      out.push(`\nDernier objet survolé : ${last.name} (${last.typeLine}, ${last.power ?? "?"}) — ${last.affixes.map((a) => a.text).join(" | ")}${last.power_text ? ` — pouvoir : ${last.power_text}` : ""}${ev ? ` → verdict local : ${ev.verdict.text}` : ""}`);
    }
    const inv = this.char.inventory.filter((c) => c.item && c.eval && ["top", "good", "later"].includes(c.eval.verdict.level));
    if (inv.length) out.push(`\nSac (dernier scan), objets à garder : ${inv.map((c) => `${c.item.name} (${c.eval.slotName}, ${c.eval.verdict.text})`).join(" ; ")}`);
    out.push(this.liveContext());
    return out.filter((l) => l != null).join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // « Sacresprit / Spiritborn »
  className(en) {
    const c = Object.values(this.matcher?.dict?.classes || {}).find((x) => x.en === en);
    return c?.fr && c.fr !== en ? `${c.fr} / ${en}` : en;
  }

  // Fiche de personnage lue dans le jeu
  sheetLines(char) {
    const s = char?.sheet;
    if (!s) return ["Fiche de personnage : jamais lue (l'ouvrir dans le jeu, touche C, pour que GitGud la retienne)."];
    const t = s.toughness || {};
    const res = Object.entries(t).filter(([k]) => !/armure|armor|points de vie|life/i.test(k));
    const parts = [
      s.weaponDamage != null && `dégâts des armes ${fmtNum(s.weaponDamage)}`,
      t["Maximum de points de vie"] != null && `vie max ${fmtNum(t["Maximum de points de vie"])}`,
      t.Armure != null && `armure ${fmtNum(t.Armure)}`,
      res.length && `robustesse par type de dégâts : ${res.map(([k, x]) => `${k} ${fmtNum(x)}`).join(", ")}`,
      Object.keys(s.stats || {}).length && Object.entries(s.stats).slice(0, 30).map(([k, x]) => `${k} ${typeof x === "number" ? fmtNum(x) : x}`).join(", "),
    ].filter(Boolean);
    return [`Fiche de personnage (lue ${ago(s.at)}) : ${parts.join(" ; ")}`];
  }

  // Équipement porté, affixe par affixe face au build : ✓ prioritaire, ~ utile, ✗ inutile
  gearLines(char, evalV) {
    const eq = Object.entries(char.equipped || {});
    if (!eq.length) return ["\nÉquipement porté : pas encore lu (survoler ses pièces portées, ou synchroniser l'équipement depuis le panneau Diablo IV)."];
    const out = [`\nÉquipement porté par ${this.charLabel(char)} (lu dans le jeu ; ✓ prioritaire pour l'emplacement, ~ utile ailleurs dans le build, ✗ inutile) :`];
    const gaps = [];
    const order = (k) => {
      const i = EQUIP_SLOTS.indexOf(k);
      return i < 0 ? 99 : i;
    };
    const mark = (c) => (c.tag === "prio" ? "✓" : c.tag === "build" || c.tag === "near" ? "~" : "✗");
    for (const [slot, it] of [...eq].sort(([a], [z]) => order(a) - order(z))) {
      if (/^(charm|seal|gem)/.test(slot)) continue;
      const ev = evaluate({ ...it, slot: itemSlotOf(slot) }, evalV, {});
      const affixes = ev ? ev.checks.map((c) => `${mark(c)} ${c.text}`).join(" | ") : it.affixes.map((a) => a.text).join(" | ");
      const rarity = [it.ancestral ? "ancestral" : null, it.rarity].filter(Boolean).join(" ");
      const aspect = ev?.aspect ? ` ; ${ev.aspect.label} ${ev.aspect.has ? "présent" : "manquant"}` : "";
      out.push(`- ${ev?.slotName || slot} : ${it.name} (${rarity || it.typeLine}, puissance ${it.power ?? "?"}) — ${affixes}${it.power_text ? ` — pouvoir : ${it.power_text.length > 260 ? it.power_text.slice(0, 260) + "…" : it.power_text}` : ""}${aspect}${ev?.missing.length ? ` ; affixes du build absents : ${ev.missing.join(", ")}` : ""}`);
      if (!ev) continue;
      const target = evalV.slots.find((x) => x.slot === ev.slot);
      if (ev.aspect && !ev.aspect.has) gaps.push(`${ev.slotName} sans ${ev.aspect.label}`);
      if (target?.kind === "unique" && !ev.isTargetUnique) gaps.push(`${ev.slotName} : l'unique visé (${target.titleFr || target.title}) n'est pas porté`);
      if (ev.missing.length >= 2) gaps.push(`${ev.slotName} : ${ev.missing.length} affixes du build absents`);
    }
    const missingSlots = EQUIP_SLOTS.filter((k) => !char.equipped[k] && evalV.slots.some((x) => x.slot === k || (k === "weapon" && /weapon/.test(x.slot))));
    if (missingSlots.length) out.push(`- Pièces portées pas encore lues : ${missingSlots.join(", ")}`);
    const charms = eq.filter(([k]) => /^(charm|seal)/.test(k)).map(([, it]) => `${it.name}${it.power_text ? ` (${it.power_text.slice(0, 140)})` : ""}`);
    if (charms.length) out.push(`- Charmes et sceau vus portés : ${charms.join(" ; ")}`);
    const wanted = evalV.slots.filter((x) => /charm/.test(x.kind) && (x.titleFr || x.title)).map((x) => x.titleFr || x.title);
    if (wanted.length) {
      const have = (n) => eq.some(([k, it]) => /^charm/.test(k) && norm(it.name).includes(norm(n)));
      const miss = wanted.filter((n) => !have(n));
      if (miss.length) gaps.push(`charmes du build non vus portés : ${miss.join(", ")}`);
    }
    if (gaps.length) out.push(`Écarts principaux avec le build : ${gaps.join(" ; ")}`);
    return out;
  }

  // Compétences, modificateurs et glyphes vus dans le jeu, face au plan du build
  seenLines(char, v) {
    const seen = char.seen;
    const out = [];
    if (!seen || !Object.keys(seen.skills || {}).length) {
      out.push("\nCompétences réelles du personnage : pas encore lues (survoler l'arbre de compétences et le Parangon pour que GitGud les retienne).");
    } else {
      const learned = Object.entries(seen.skills).filter(([, x]) => x.learned).map(([n, x]) => `${n} ${x.rank}/${x.max}`);
      out.push(`\nCompétences apprises (vues dans le jeu, ${ago(Math.max(...Object.values(seen.skills).map((x) => x.at)))}) : ${learned.join(", ") || "aucune"}`);
      const mods = Object.entries(seen.mods || {}).filter(([, x]) => x.learned).map(([n]) => n);
      if (mods.length) out.push(`Modificateurs appris : ${mods.join(", ")}`);
      const plan = v?.plan?.skills || [];
      if (plan.length) {
        const find = (name) => name && Object.entries(seen.skills).find(([n]) => norm(n) === norm(name));
        const diffs = [];
        const unseen = [];
        for (const p of plan) {
          const s = find(p.fr) || find(p.en);
          if (!s) unseen.push(p.fr || p.en);
          else if (!s[1].learned) diffs.push(`${p.fr} non apprise (visée rang ${p.rank})`);
          else if (p.rank && s[1].rank < p.rank) diffs.push(`${p.fr} rang ${s[1].rank} au lieu de ${p.rank}`);
        }
        if (diffs.length) out.push(`Écarts avec les compétences du build : ${diffs.join(" ; ")}`);
        if (unseen.length) out.push(`Compétences du build pas encore vues dans le jeu : ${unseen.join(", ")}`);
      }
    }
    const glyphs = Object.keys(seen?.glyphs || {});
    if (glyphs.length) out.push(`Glyphes vus sur le Parangon : ${glyphs.join(", ")}`);
    const nodes = Object.entries(seen?.nodes || {}).filter(([, x]) => x.allocated).map(([n]) => n);
    if (nodes.length) out.push(`Nœuds rares / légendaires du Parangon pris : ${nodes.slice(0, 30).join(", ")}`);
    return out;
  }
}

// Fiche de personnage présente dans une infobulle
const SHEET_HINT = /^(Dégâts des armes|Weapon Damage)\s*:|robustesse est une estimation|toughness is an estimate|^(Force|Intelligence|Volonté|Dextérité)\s*:\s*\d/i;
const sheetNum = (t) => Number(String(t).replace(/[\s  ]/g, "").replace(",", ".")) || 0;
const fmtNum = (n) => Number(n).toLocaleString("fr-FR");
// « il y a 12 min »
function ago(t) {
  if (!t) return "à une date inconnue";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} jours`;
}

// Minuscules sans accents, pour reconnaître un nom de build ou de classe dans une question
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Ressource de chaque classe telle que le jeu l'affiche (le Démoniste l'apprend de sa fiche)
const CLASS_RESOURCE = { Spiritborn: "Vigueur", Barbarian: "Fureur", Druid: "Esprit", Sorcerer: "Mana", Rogue: "Énergie", Necromancer: "Essence", Paladin: "Foi" };
// Mots trop courants dans les noms de builds pour désigner l'un d'eux
const STOP = new Set(["build", "guide", "endgame", "starter", "mythic", "pushing", "speedfarm", "leveling", "levelling", "best", "fast", "with", "pour", "sans", "season", "saison"]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// « MrRonit's Blazing Scream 1-70 FAST (Best Warlock Levelling Build) » → nom court pour l'overlay
const shortName = (n) => String(n || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);

module.exports = { D4Manager, EQUIP_SLOTS };
