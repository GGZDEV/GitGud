// Diagnostic des correspondances Diablo IV sur les vraies données du joueur :
// node scripts/d4-diagnose.js [dossier de données]  (par défaut %APPDATA%/gitgud)
// 1. affixes des builds importés : à quelle caractéristique du jeu chacun a été rattaché ;
// 2. objets vus en jeu (journal, équipement, sac) : chaque ligne d'affixe et sa reconnaissance.
const fs = require("fs");
const path = require("path");
const { AffixMatcher } = require("../src/games/d4/affixes");
const { parseItem } = require("../src/games/d4/item");

const dir = process.argv[2] || path.join(process.env.APPDATA, "gitgud");
const dict = JSON.parse(fs.readFileSync(path.join(dir, "d4", "dict.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(dir, "d4", "state.json"), "utf8"));
let log = [];
try {
  log = JSON.parse(fs.readFileSync(path.join(dir, "d4", "tooltips-log.json"), "utf8"));
} catch {}
const matcher = new AffixMatcher(dict);
const verbose = process.argv.includes("-v");

console.log("=== Affixes des builds ===");
for (const b of state.builds) {
  const seen = new Map();
  for (const v of b.variants) for (const s of v.slots) for (const a of s.affixes || []) seen.set(a.slug || a.key || a.label, a);
  const bad = [...seen.values()].filter((a) => !a.key && !a.terms);
  console.log(`${b.name} (${b.className}) : ${seen.size} affixes distincts, ${bad.length} sans correspondance`);
  for (const a of seen.values()) {
    const tag = !a.key && !a.terms ? "✗" : " ";
    if (verbose || tag === "✗") console.log(`  ${tag} ${String(a.slug || "").padEnd(42)} → ${a.key || "-"} « ${a.label} » familles=${(a.keys || []).length}${a.must?.length ? " must=" + a.must.join("/") : ""}`);
  }
}

console.log("\n=== Lignes d'objets vues en jeu ===");
const items = [];
for (const e of log) items.push(e.lines);
for (const c of state.characters) {
  for (const it of Object.values(c.equipped || {})) it?.lines && items.push(it.lines);
  for (const cell of c.inventory || []) cell?.item?.lines && items.push(cell.item.lines);
}
const lines = new Map();
for (const ls of items) {
  const it = parseItem(ls, matcher);
  if (!it) continue;
  for (const a of [...it.affixes, ...it.tempered]) if (!lines.has(a.text)) lines.set(a.text, { a, item: it.name });
}
const rows = [...lines.values()].sort((x, y) => x.a.score - y.a.score);
let weak = 0;
for (const { a, item } of rows) {
  const label = a.key ? matcher.label(a.key) : "—";
  const flag = a.score < 0.5 ? "✗" : a.score < 0.75 ? "~" : " ";
  if (flag !== " ") weak++;
  if (verbose || flag !== " ") console.log(`${flag} ${a.score.toFixed(2)} « ${a.text} » → ${a.key || "-"} (${label})   [${item}]`);
}
console.log(`\n${rows.length} lignes d'affixes distinctes, ${weak} reconnues faiblement ou pas du tout.`);
