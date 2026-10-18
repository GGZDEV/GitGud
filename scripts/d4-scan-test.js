// Test du scan sans toucher à la vraie souris : module souris simulé, et chaque case
// « survolée » renvoie une infobulle par le pont (comme le jeu).
const fs = require("fs");
const os = require("os");
const path = require("path");

// Souris simulée : arrive toujours à destination, et le « jeu » répond par une infobulle
let manager = null;
const fake = {
  pos: { x: 0, y: 0 },
  cursor: () => ({ ...fake.pos }),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
  glideTo: async (x, y) => {
    fake.pos = { x, y };
    const n = Math.round(x) % 3;
    const lines = n === 0
      ? ["PRISE DE LA PESTILENCE", "Gants ancestraux légendaires", "800 Puissance de l'objet", "910 Armure (Robustesse : +2 %)", "+99 dextérité [86 - 100]", "Multiplicateur de dégâts contre les cibles vulnérables : x17 % [12 - 20] %", "Multiplicateur de dégâts sur la durée : x19,5 % [12 - 20] %", "Bouton droit de la souris"]
      : ["ANNEAU DU VOYAGEUR", "Bague rare", "750 Puissance de l'objet", "+42 % de résistance au froid [30 - 50] %", "+6,1 % à la vitesse d’attaque [5 - 9] %", "Bouton droit de la souris"];
    setTimeout(() => lines.forEach((l) => manager.bridge.onLine(l)), 10);
    return { x, y };
  },
};
require.cache[require.resolve("../src/games/d4/mouse")] = { exports: fake, loaded: true, id: "mouse" };

const { D4Manager } = require("../src/games/d4/manager");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d4scan-"));
fs.mkdirSync(path.join(dir, "d4"));
fs.copyFileSync(path.join(__dirname, "..", "build", "d4", "dict.json"), path.join(dir, "d4", "dict.json"));

(async () => {
  manager = new D4Manager(dir);
  manager.setCursorProvider(fake.cursor);
  await manager.ready();
  manager.addBuild(JSON.parse(JSON.stringify(require("../build/d4/test-build.json"))));
  manager.state.positions.inventory = { tl: { x: 100, y: 500 }, br: { x: 600, y: 620 } };
  manager.on("scan", (p) => p.phase !== "progress" && console.log("scan :", p.phase, p.total ?? "", p.cells ? `${p.cells.filter((c) => c.item).length} objets lus` : ""));
  const t = Date.now();
  const cells = await manager.scan();
  const keep = cells.filter((c) => ["top", "good"].includes(c.eval?.verdict.level)).length;
  console.log(`terminé en ${Date.now() - t} ms : ${cells.length} cases, ${cells.filter((c) => c.item).length} objets, ${keep} à garder`);
})();
