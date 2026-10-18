// Test du lecteur d'infobulles sur les vraies infobulles anglaises des tests de D4LF.
// Usage : node scripts/d4-parse-test.js <parser_equipment.json>
const path = require("path");
const { getDict } = require("../src/games/d4/data");
const { AffixMatcher, clean } = require("../src/games/d4/affixes");
const { parseItem } = require("../src/games/d4/item");
(async () => {
  const dict = await getDict(path.join(__dirname, "..", "build"));
  const matcher = new AffixMatcher(dict);
  const samples = require(path.resolve(process.argv[2]));
  let items = 0, slotOk = 0, affixTotal = 0, affixFound = 0, keyed = 0;
  for (const s of samples) {
    const lines = s.input || s.tts || s.data;
    const exp = s.expected;
    const it = parseItem(lines, matcher);
    if (!it) { console.log("✗ non reconnu :", lines.slice(0, 2).join(" / ")); continue; }
    items++;
    const expSlot = exp.item_type;
    if (expSlot && (it.slot === expSlot || (expSlot.includes("ring") && it.slot === "ring") || (it.slot === "weapon" && /sword|axe|mace|staff|bow|dagger|wand|scythe|polearm|glaive|crossbow|flail/.test(expSlot)) || (it.slot === "chest-armor" && expSlot === "chest armor") || (it.slot === "offhand" && /shield|focus|totem/.test(expSlot)))) slotOk++;
    else console.log(`  emplacement : attendu ${expSlot}, trouvé ${it.slot} (« ${it.typeLine} »)`);
    const want = (exp.affixes || []).map((a) => a.text);
    affixTotal += want.length;
    const got = it.affixes.map((a) => a.text);
    for (const w of want) if (got.includes(w)) affixFound++; else console.log(`  affixe manqué : « ${w} » (${it.name})`);
    keyed += it.affixes.filter((a) => a.key).length;
  }
  console.log(`\n${items}/${samples.length} objets lus, emplacement juste ${slotOk}/${items}, affixes extraits ${affixFound}/${affixTotal}, reconnus dans le dictionnaire ${keyed}`);
})();
