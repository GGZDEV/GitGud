// Test des imports de builds (Mobalytics, Maxroll, D4Builds) avec le vrai dictionnaire.
// Usage : npx electron scripts/d4-import-test.js <url> [url…]
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { getDict } = require("../src/games/d4/data");
const { AffixMatcher } = require("../src/games/d4/affixes");
const { importBuild } = require("../src/games/d4/build-import");

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const dict = await getDict(path.join(__dirname, "..", "build"));
  const matcher = new AffixMatcher(dict);
  for (const url of process.argv.filter((a) => /^https?:/.test(a))) {
    const t = Date.now();
    try {
      const b = await importBuild(url, matcher, dict);
      if (/mobalytics/.test(url)) fs.writeFileSync(path.join(__dirname, "..", "build", "d4", "test-build.json"), JSON.stringify(b, null, 1));
      const v = b.variants.find((x) => x.id === b.preferredVariant) || b.variants.find((x) => /end ?game/i.test(x.name)) || b.variants[0];
      console.log(`\n✓ ${b.source} — « ${b.name} » (${b.className || "?"}) en ${Date.now() - t} ms · variantes : ${b.variants.map((x) => x.name).join(", ")}`);
      for (const s of v.slots.filter((s) => s.affixes.length).slice(0, 5)) {
        console.log(`   ${s.slotName} : ${s.titleFr || s.title || "?"} → ${s.affixes.map((a) => (a.greater ? "★" : "") + a.label).join(" · ")}`);
      }
      const n = v.slots.reduce((k, s) => k + s.affixes.length, 0);
      console.log(`   … ${v.slots.length} emplacements, ${n} affixes`);
    } catch (err) {
      console.log(`\n✗ ${url} → ${err.message}`);
    }
  }
  app.quit();
});
