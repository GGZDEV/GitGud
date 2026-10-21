// Tests de l'évaluation des objets Diablo IV, sur un vrai build et de vrais objets vus en jeu
// (scripts/fixtures/d4-eval.json) : node scripts/d4-eval-test.js
// Il faut le dictionnaire du jeu (téléchargé au premier lancement de l'app) : sinon le test est sauté.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { AffixMatcher } = require("../src/games/d4/affixes");
const { parseItem } = require("../src/games/d4/item");
const { evaluate, keepBestPerSlot } = require("../src/games/d4/evaluate");

const dictPath = [path.join(process.env.APPDATA || "", "gitgud", "d4", "dict.json"), path.join(__dirname, "..", "build", "d4", "dict.json")].find((p) => fs.existsSync(p));
if (!dictPath) {
  console.log("Dictionnaire Diablo IV absent : test sauté (lance l'app une fois).");
  process.exit(0);
}
const matcher = new AffixMatcher(JSON.parse(fs.readFileSync(dictPath, "utf8")));
const fx = require("./fixtures/d4-eval.json");
const variant = fx.variant;
const parse = (lines) => parseItem(lines, matcher);
const equipped = Object.fromEntries(Object.entries(fx.equipped).map(([k, lines]) => [k, parse(lines)]));
const item = (k) => parse(fx.items[k]);
const ev = (it, eq = equipped) => evaluate(it, variant, eq, []);
const KEEP = ["top", "good"];

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (err) {
    failed++;
    console.log("FAIL", name, "\n     ", err.message);
  }
}

test("raretés accordées : « Gants ancestraux légendaires », « Gants rares »", () => {
  const g = equipped.gloves;
  assert.strictEqual(g.rarity, "legendary");
  assert.strictEqual(g.ancestral, true);
  assert.strictEqual(item("strangulateurs").rarity, "rare");
  assert.strictEqual(equipped.amulet.rarity, "unique");
});

test("écarts du jeu et propriétés perdues lus", () => {
  const s = item("strangulateurs");
  assert.strictEqual(s.affixes[0].delta, -956);
  assert.ok(s.lost.length >= 4 && s.lostPower);
});

test("gants rares 850 < gants ancestraux de pestilence portés", () => {
  const e = ev(item("strangulateurs"));
  assert.ok(!KEEP.includes(e.verdict.level), e.verdict.text);
  assert.ok(e.compare.net < 0);
  assert.ok(e.compare.losses.some((l) => /pestilence/i.test(l)), e.compare.losses.join(" | "));
});

test("et dans l'autre sens : les gants ancestraux battent les rares", () => {
  const e = ev(equipped.gloves, { ...equipped, gloves: item("strangulateurs") });
  assert.ok(KEEP.includes(e.verdict.level), e.verdict.text);
});

test("poison et dégâts sur la durée comptent sur des gants (utiles au build)", () => {
  const e = ev(equipped.gloves, {});
  const tag = (re) => e.checks.find((c) => re.test(c.text))?.tag;
  assert.ok(["build", "prio"].includes(tag(/poison/)), tag(/poison/));
  assert.ok(["build", "near", "prio"].includes(tag(/sur la dur/)), tag(/sur la dur/));
  assert.strictEqual(tag(/vitesse d.attaque/), "none");
});

test("130 de dextérité au lieu de 140 : une perte, pas un gain", () => {
  const base = ["AMULETTE TEST", "Amulette ancestrale légendaire", "Puissance de l’objet : 900"];
  const worn = parse([...base, "+140 dextérité [125 - 149]"]);
  const lower = parse([...base, "+130 dextérité [125 - 149] (-10)"]);
  const e = ev(lower, { amulet: worn });
  assert.ok(e.compare.net < 0, String(e.compare.net));
  assert.ok(!KEEP.includes(e.verdict.level), e.verdict.text);
  assert.ok(e.compare.losses.some((l) => /dext/.test(l)));
});

test("amulette légendaire moins bonne que l'unique portée", () => {
  const e = ev(item("oeillet"));
  assert.ok(!KEEP.includes(e.verdict.level), e.verdict.text);
});

test("unique hors build : à recycler", () => {
  const e = ev(item("blouse"));
  assert.strictEqual(e.verdict.level, "bad");
  assert.ok(/unique hors build/i.test(e.verdict.text));
});

test("torse légendaire : base à imprégner face à un torse rare sans aspect", () => {
  const e = ev(item("haubert"));
  assert.ok(KEEP.includes(e.verdict.level), e.verdict.text);
});

test("équipement ancestral : un objet non ancestral est recyclé", () => {
  const anc = { ...equipped, weapon: { ...equipped.gloves, slot: "weapon" }, pants: { ...equipped.gloves, slot: "pants" } };
  const e = ev(item("oeillet"), { ...anc, amulet: { ...equipped.gloves, name: "X", slot: "amulet", rarity: "legendary" } });
  assert.ok(!KEEP.includes(e.verdict.level), e.verdict.text);
});

test("un seul objet gardé par emplacement après un scan", () => {
  const cells = ["haubert", "harnois"].map((k, i) => {
    const it = item(k);
    const e = ev(it);
    e.verdict = { level: "good", text: "x" };
    e.rank = i === 0 ? 1 : 0.5;
    return { row: 0, col: i, item: it, eval: e };
  });
  keepBestPerSlot(cells);
  assert.deepStrictEqual(cells.map((c) => c.eval.verdict.level), ["good", "bad"]);
  assert.ok(/HAUBERT/.test(cells[1].eval.verdict.text));
});

test("équipement mémorisé : pas d'objet incohérent ni de position hors synchronisation", () => {
  const { D4Manager } = require("../src/games/d4/manager");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitgud-d4-"));
  const m = new D4Manager(dir);
  m.matcher = matcher;
  m.state.positions.inventory = { tl: { x: 1700, y: 1000 }, br: { x: 2450, y: 1230 } };
  // Simple survol : objet retenu, position non
  m.recordEquipped(equipped.gloves, { x: 800, y: 500 }, true);
  assert.ok(m.equipped.gloves && !m.state.positions.equip.gloves);
  // Synchronisation : position retenue, sauf sur la grille du sac
  m.recordEquipped(equipped.amulet, { x: 1500, y: 600 }, false);
  assert.deepStrictEqual(m.state.positions.equip.amulet, { x: 1500, y: 600 });
  m.recordEquipped(equipped["chest-armor"], { x: 1800, y: 1100 }, false);
  assert.ok(m.equipped["chest-armor"] && !m.state.positions.equip["chest-armor"]);
  // Texte d'une autre fenêtre du jeu : ignoré
  m.recordEquipped({ ...equipped.gloves, name: "NO GRAMMATICAL FORM FROM CALLER OR NOUN MARKUP" }, { x: 1, y: 1 }, true);
  assert.strictEqual(m.equipped.gloves.name, equipped.gloves.name);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(failed ? `\n${failed} échec(s)` : "\nTout est vert.");
process.exit(failed ? 1 : 0);
