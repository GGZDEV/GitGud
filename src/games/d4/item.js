// Lecture d'une infobulle d'objet Diablo IV (lignes envoyées par le lecteur d'écran du jeu),
// en français ou en anglais : nom, type, emplacement, puissance, affixes avec valeur et
// fourchette, trempes, pouvoir légendaire/unique, comparaison avec l'objet équipé.
const { clean } = require("./affixes");

// Type d'objet (mots de la 2e ligne) → emplacement du build
// Types d'objets officiels (clés Maxroll, noms FR/EN dans le dictionnaire) → emplacement du build
const TYPE_SLOTS = {
  Helm: "helm", ChestArmor: "chest-armor", Gloves: "gloves", Legs: "pants", Boots: "boots", Amulet: "amulet", Ring: "ring",
  Shield: "offhand", ShieldHTH: "offhand", Amazon_Shield: "offhand", Focus: "offhand", FocusBookOffHand: "offhand", OffHandTotem: "offhand", DaggerOffHand: "offhand",
  Charm: "charm", HoradricSeal: "seal", Rune: "rune", ConditionRune: "rune", EffectRune: "rune", Gem: "gem",
  Mace: "weapon", Mace2H: "weapon", Mace2HDruid: "weapon", Sword: "weapon", Sword2H: "weapon", Sword_Phase_Blade: "weapon",
  Axe: "weapon", Axe2H: "weapon", Axe_Berserker_Axe: "weapon", Staff: "weapon", StaffDruid: "weapon", StaffSorcerer: "weapon",
  Quarterstaff: "weapon", Glaive: "weapon", Scythe: "weapon", Scythe2H: "weapon", Dagger: "weapon", Polearm: "weapon",
  Wand: "weapon", Bow: "weapon", Crossbow: "weapon", Crossbow2H: "weapon", Flail: "weapon", Amazon_Spear: "weapon",
};

// Emplacement d'après la ligne de type (« Heaume ancestral légendaire », « Couteau de brèche… ») :
// le nom de type officiel le plus long contenu dans la ligne l'emporte.
function slotFromTypes(typeClean, dict) {
  let best = null;
  for (const [key, slot] of Object.entries(TYPE_SLOTS)) {
    for (const name of [dict?.itemTypes?.[key]?.fr, dict?.itemTypes?.[key]?.en]) {
      const n = name && clean(name);
      if (n && ` ${typeClean} `.includes(` ${n} `) && (!best || n.length > best.len)) best = { slot, len: n.length };
    }
  }
  return best?.slot || null;
}

// Repli si le dictionnaire est indisponible
const SLOT_WORDS = [
  ["helm", /\b(casque|heaume|helm)\b/],
  ["chest-armor", /\b(cuirasse|torse|chest armor|chest)\b/],
  ["gloves", /\b(gants|gloves)\b/],
  ["pants", /\b(jambieres|pantalon|pants)\b/],
  ["boots", /\b(bottes|boots)\b/],
  ["amulet", /\b(amulette|amulet)\b/],
  ["ring", /\b(anneau|bague|ring)\b/],
  ["offhand", /\b(bouclier|shield|catalyseur|focalisateur|focus|totem)\b/],
  ["charm", /\b(charme|charm)\b/],
  ["seal", /\b(sceau|seal)\b/],
  ["rune", /\b(rune)\b/],
  ["weapon", /\b(baton|quarterstaff|staff|glaive|hache|axe|epee|sword|masse|mace|dague|dagger|arc|bow|arbalete|crossbow|faux|scythe|baguette|wand|fleau|flail|arme d hast|polearm|lance)\b/],
];

const RARITIES = [
  ["mythic", /\b(mythique|mythic)\b/],
  ["unique", /\b(unique)\b/],
  ["legendary", /\b(legendaire|legendary)\b/],
  ["rare", /\b(rare)\b/],
  ["magic", /\b(magique|magic)\b/],
];

// Pied d'infobulle (comparé au texte nettoyé : sans chiffres ni accents)
const FOOTER = /^(prix de vente|sell value|requiert le niveau|requires level|niveau requis|durabilite|durability|bouton (gauche|droit)|left mouse|right mouse|molette|mousewheel|scroll|clic |faire defiler|objet de (lord|vessel)|lie au compte|account bound)/;
// Mot runique serti : « MoniKry (100/300) – Déchaînement d'alacrité »
const RUNEWORD = /\(\s*\d+\s*\/\s*\d+\s*\)\s*[–-]/;
const COMPARE = /^(proprietes perdues|properties lost|proprietes obtenues|properties gained)/;
const SOCKET = /^(emplacement vide|empty socket|chasse vide)/;
// Caractéristiques de base (armes, boucliers) : propriétés implicites, pas des affixes
const BASE_STAT = /(damage per hit|degats par coup|attacks per second|attaques par seconde|block chance|chances de blocage|main hand weapon damage|degats de l arme principale|^(armor|armure)$)/;

// « +1 760 », « 12,5 », « 1,760 » (anglais) → nombre
function parseNumber(s) {
  let t = String(s).replace(/[\s  ]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ""); // milliers anglais
  else t = t.replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`[+-]?\d[\d\s  .,]*`;

function parseValueLine(line) {
  const value = line.match(new RegExp(NUM));
  const range = line.match(new RegExp(String.raw`\[\s*(${NUM})\s*(?:-\s*(${NUM}))?\s*\]`));
  return {
    value: value ? parseNumber(value[0]) : null,
    min: range ? parseNumber(range[1]) : null,
    max: range ? parseNumber(range[2] ?? range[1]) : null,
  };
}

// lines : lignes de l'infobulle ; matcher : AffixMatcher
function parseItem(lines, matcher) {
  if (!lines?.length) return null;
  const name = lines[0];
  const typeLine = lines[1] || "";
  const t = clean(typeLine);
  const slot = slotFromTypes(t, matcher.dict) || SLOT_WORDS.find(([, re]) => re.test(t))?.[0] || null;
  const rarity = RARITIES.find(([, re]) => re.test(t))?.[0] || null;
  if (!slot && !rarity) return null; // pas un équipement (compétence, glyphe, menu…)

  const item = {
    lines, // texte brut, pour relire l'objet si les règles de lecture évoluent
    name,
    typeLine,
    slot,
    rarity,
    ancestral: /\b(ancestral|ancestrale)\b/.test(t),
    power: null,
    masterwork: null,
    implicits: [],
    affixes: [],
    tempered: [],
    power_text: null,
    sockets: 0,
    runeword: null,
    lostWhenEquipped: [],
    hasComparison: false,
  };

  // Un objet du sac se compare toujours à la pièce portée : « 1 603 Armure (Robustesse : +14,6 %) »,
  // « 3 674 Dégâts par seconde (+220) ». Une pièce portée n'affiche jamais ces écarts.
  if (lines.some((l) => /\(\s*(robustesse|toughness)\s*:|\(\s*[+-]\s*\d/i.test(l))) item.hasComparison = true;

  let section = "head";
  for (const raw of lines.slice(2)) {
    const line = raw.trim();
    const c = clean(line);
    if (!line) continue;
    // « 800 Puissance de l'objet » ou « Puissance de l'objet : 800 »
    const power = line.match(/(\d[\d\s .,]*)\s+(puissance|item power)/i) || line.match(/(?:puissance de l.objet|item power)\s*:?\s*(\d[\d\s .,]*)/i);
    if (power && item.power == null) {
      item.power = parseNumber(power[1]);
      continue;
    }
    const mw = line.match(/(chef d.?(œ|oe)uvre|masterwork)\D*(\d+)\s*\/\s*(\d+)/i);
    if (mw) {
      item.masterwork = { rank: Number(mw[3]), max: Number(mw[4]) };
      continue;
    }
    if (COMPARE.test(c)) {
      section = "compare";
      item.hasComparison = true;
      continue;
    }
    if (FOOTER.test(c)) {
      section = "footer";
      continue;
    }
    if (SOCKET.test(c)) {
      item.sockets++;
      continue;
    }
    if (RUNEWORD.test(line)) {
      item.runeword = line;
      section = "runeword"; // les lignes suivantes décrivent l'effet du mot runique
      continue;
    }
    if (section === "runeword" && !/^[+-]?\d/.test(line)) continue;
    if (section === "compare") {
      item.lostWhenEquipped.push(line);
      continue;
    }
    if (section === "footer") continue;

    const hasNumber = /\d/.test(line);
    const v = parseValueLine(line);
    // Armure de base (« 905 Armure », sans « + » ni fourchette) ≠ affixe d'armure (« +933 Armure [780 - 980] »)
    if (BASE_STAT.test(c) && !(/^(armor|armure)$/.test(c) && (/^\+/.test(line) || v.min != null))) {
      item.implicits.push({ text: line, key: null, ...v });
      continue;
    }
    // Une ligne reconnue par le dictionnaire est un affixe, même longue (« Coup de chance : jusqu'à… »).
    // Une phrase non reconnue est le pouvoir légendaire/unique (la 1re), puis le texte d'ambiance.
    const m = hasNumber ? matcher.matchLine(line) : { key: null, score: 0 };
    const isSentence = line.length > 70 || (line.match(/\./g) || []).length >= 2;
    const isAffix = hasNumber && (m.score >= 0.6 || (!isSentence && section !== "flavor"));
    if (!isAffix) {
      if (isSentence && !item.power_text && section !== "flavor") {
        item.power_text = line;
        item.power_roll = v.min != null ? v : null;
        section = "after-power";
      } else if (item.power_text) {
        section = "flavor";
      }
      continue;
    }
    const affix = { text: line, key: m.score >= 0.5 ? m.key : null, score: m.score, ...v };
    if (section === "after-power") item.tempered.push(affix); // lignes après le pouvoir : trempes
    // armure, blocage… de base : avant les affixes, sans fourchette ou à valeur fixe (« +890 à l'armure [890] »)
    else if (item.affixes.length === 0 && (/^\d/.test(line) && v.min == null || (/arm(or|ure)/.test(c) && v.min === v.max))) item.implicits.push(affix);
    else item.affixes.push(affix);
  }
  return item;
}

// Qualité d'un tirage dans sa fourchette (0..1), ou null sans fourchette
function rollQuality(a) {
  if (a.value == null || a.min == null || a.max == null) return null;
  if (a.max === a.min) return 1;
  return Math.max(0, Math.min(1, (a.value - a.min) / (a.max - a.min)));
}

module.exports = { parseItem, rollQuality, parseNumber };
