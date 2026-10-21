// Rejoue les objets vus en jeu (journal, équipement, sac) avec les règles actuelles, sur une
// copie des données du joueur : node scripts/d4-replay.js [dossier de données]
const fs = require("fs");
const os = require("os");
const path = require("path");

const src = process.argv[2] || path.join(process.env.APPDATA, "gitgud");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitgud-d4-"));
fs.mkdirSync(path.join(tmp, "d4"));
for (const f of ["dict.json", "state.json", "tooltips-log.json"]) {
  if (fs.existsSync(path.join(src, "d4", f))) fs.copyFileSync(path.join(src, "d4", f), path.join(tmp, "d4", f));
}

const { D4Manager } = require("../src/games/d4/manager");
const { parseItem } = require("../src/games/d4/item");
const { evaluate } = require("../src/games/d4/evaluate");

(async () => {
  const m = new D4Manager(tmp);
  m.refreshPlans = async () => {}; // pas de réseau
  await m.ready();
  console.log(`Personnage suivi : ${m.charLabel()} (${m.char.className}) — build « ${m.build?.name} », variante ${m.variant?.name}\n`);

  const inferred = m.evalVariant.slots.filter((s) => s.inferred);
  if (inferred.length) console.log(`Pièces sans priorités dans le guide, déduites : ${inferred.map((s) => s.slotName).join(", ")}\n  → ${inferred[0].affixes.map((a) => a.label).join(", ")}\n`);

  const log = JSON.parse(fs.readFileSync(path.join(tmp, "d4", "tooltips-log.json"), "utf8"));
  const seen = new Set();
  const items = [...log.map((e) => e.lines), ...m.char.inventory.filter((c) => c.item).map((c) => c.item.lines)];
  for (const lines of items) {
    const it = parseItem(lines, m.matcher);
    if (!it?.slot || seen.has(it.name)) continue;
    seen.add(it.name);
    const ev = evaluate(it, m.evalVariant, m.equipped, m.otherVariants());
    if (!ev) {
      console.log(`· ${it.name} [${it.slot}] — emplacement absent du build`);
      continue;
    }
    console.log(`${{ top: "★", good: "✓", later: "↗", meh: "~", bad: "✗", neutral: "·" }[ev.verdict.level]} ${it.name} [${it.slot}] — ${ev.verdict.text}`);
    for (const l of ev.later || []) console.log(`    ↗ ${l.variant} : ${l.text}`);
  }

  // Objets d'un autre personnage tombés sur celui qu'on joue : doivent être signalés « à garder »
  const other = m.state.characters.find((c) => c.id !== m.char.id && Object.keys(c.equipped).length);
  if (other) {
    console.log(`\nSi les pièces de ${m.charLabel(other)} tombaient sur ${m.charLabel()} :`);
    for (const worn of Object.values(other.equipped)) {
      const it = parseItem(worn.lines, m.matcher);
      if (!it?.slot) continue;
      const ev = evaluate(it, m.evalVariant, {}, m.otherVariants());
      const l = ev?.later?.find((x) => x.variant.startsWith(m.charLabel(other)));
      console.log(`  ${ev?.verdict.level === "later" ? "↗" : " "} ${it.name} [${it.slot}] — ${ev ? ev.verdict.text : "—"}${l && ev.verdict.level !== "later" ? `  (↗ ${l.variant} : ${l.text})` : ""}`);
    }
  }
  if (other) {
    const worn = Object.values(other.equipped)[0];
    const before = m.charLabel();
    let event = null;
    m.on("character", (e) => (event = e));
    m.switchToWearer(parseItem(worn.lines, m.matcher));
    console.log(`\nBascule : survol de « ${worn.name} » (porté par ${m.charLabel(other)}) pendant ${before} → ${m.charLabel()} ${event ? `(événement ${event.kind}, build « ${event.build} »)` : "(aucune bascule)"}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
