// Test de bout en bout sans le jeu : infobulles françaises (reconstituées d'après les textes
// officiels) → lecture → évaluation contre le build importé (build/d4/test-build.json).
const path = require("path");
const { getDict } = require("../src/games/d4/data");
const { AffixMatcher } = require("../src/games/d4/affixes");
const { parseItem } = require("../src/games/d4/item");
const { evaluate } = require("../src/games/d4/evaluate");

const TOOLTIPS = {
  "gants équipés (moyens)": [
    "POIGNES DU CRÉPUSCULE", "Gants ancestraux légendaires", "800 Puissance de l'objet",
    "+890 à l’armure [890]",
    "+96 dextérité [86 - 100]",
    "+11,5 % de chances d’infliger un coup critique [8 - 14] %",
    "Multiplicateur de dégâts sur la durée : x18 % [12 - 20] %",
    "+7,2 % à la vitesse d’attaque [5 - 9] %",
    "Vos attaques de base infligent 25 % de dégâts de poison supplémentaires pendant 4 secondes.",
    "Prix de vente : 54 120 or", "Requiert le niveau 60", "Bouton droit de la souris",
  ],
  "gants trouvés (parfaits)": [
    "PRISE DE LA PESTILENCE", "Gants ancestraux légendaires", "800 Puissance de l'objet",
    "+910 à l’armure [910]",
    "+99 dextérité [86 - 100]",
    "Multiplicateur de dégâts contre les cibles vulnérables : x17 % [12 - 20] %",
    "Multiplicateur de dégâts sur la durée : x19,5 % [12 - 20] %",
    "Maximum de vie augmenté de +1 120 [900 - 1 200]",
    "Vos attaques de base infligent 25 % de dégâts de poison supplémentaires pendant 4 secondes.",
    "Propriétés perdues si équipé :", "+11,5 % de chances d’infliger un coup critique",
    "Prix de vente : 61 802 or", "Requiert le niveau 60", "Bouton droit de la souris",
  ],
  "anneau trouvé (mauvais)": [
    "ANNEAU DU VOYAGEUR", "Anneau rare", "750 Puissance de l'objet",
    "+42 % de résistance au froid [30 - 50] %",
    "+6,1 % à la vitesse d’attaque [5 - 9] %",
    "+3 à l’armure [2 - 4]",
    "Prix de vente : 9 802 or", "Bouton droit de la souris",
  ],
};

(async () => {
  const dict = await getDict(path.join(__dirname, "..", "build"));
  const matcher = new AffixMatcher(dict);
  const build = require("../build/d4/test-build.json");
  const variant = build.variants.find((v) => v.name === "Endgame");
  const equipped = {};
  for (const [name, lines] of Object.entries(TOOLTIPS)) {
    const item = parseItem(lines, matcher);
    if (name.includes("équipés")) equipped.gloves = item;
    const ev = evaluate(item, variant, equipped);
    console.log(`\n■ ${name} — ${item.name} (${item.typeLine}, ${item.slot}, ${item.power})`);
    for (const c of ev.checks) {
      const q = c.quality == null ? "" : ` ${"▮".repeat(Math.round(c.quality * 5)).padEnd(5, "▯")} ${Math.round(c.quality * 100)} %`;
      console.log(`   ${c.wanted ? "✓" : "✗"} ${c.text}${c.wanted ? q : ""}${c.greaterWanted ? "  (★ voulu supérieur)" : ""}`);
    }
    console.log(`   → ${ev.verdict.text}${ev.upgrade ? ` | ${ev.upgrade.better ? "MIEUX" : ev.upgrade.worse ? "moins bien" : "équivalent"} que ${ev.upgrade.than} (${ev.upgrade.currentWanted}/${ev.upgrade.currentTotal})` : ""}`);
    if (ev.missing.length) console.log(`   manque : ${ev.missing.join(" · ")}`);
    if (item.power_text) console.log(`   pouvoir : ${item.power_text.slice(0, 70)}…`);
  }
})();
