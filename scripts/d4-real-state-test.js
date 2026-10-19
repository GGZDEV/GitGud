// Relit l'état Diablo IV réel de l'utilisateur (objets lus dans son jeu) avec les règles
// actuelles, sans le modifier. Usage : node scripts/d4-real-state-test.js
const fs = require("fs"), os = require("os"), path = require("path");
const { D4Manager } = require("../src/games/d4/manager");
const { evaluate } = require("../src/games/d4/evaluate");
const src = path.join(process.env.APPDATA, "gamehelper", "d4");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d4real-"));
fs.mkdirSync(path.join(dir, "d4"));
for (const f of ["state.json", "dict.json"]) fs.copyFileSync(path.join(src, f), path.join(dir, "d4", f));
(async () => {
  const m = new D4Manager(dir);
  await m.ready();
  const v = m.variant;
  console.log(`variante : ${v.name}`);
  for (const [slot, it] of Object.entries(m.equipped)) {
    const ev = evaluate(it, v, {});
    console.log(`\n${slot} — ${it.name} (${it.typeLine}) → emplacement lu : ${it.slot}`);
    for (const c of ev?.checks || []) console.log(`   ${c.wanted ? "✓" : "✗"} ${c.text}`);
    console.log(`   → ${ev?.verdict.text || "pas d'évaluation"}${it.runeword ? ` | mot runique : ${it.runeword}` : ""}`);
  }
})();
