// Reconnaissance des affixes : rapproche une ligne d'infobulle (français ou anglais) ou un
// identifiant Mobalytics (« damage-over-time-multiplier ») d'une même clé d'affixe Maxroll.
const STOP = new Set([
  "to", "the", "of", "a", "an", "and", "your", "you", "for", "with", "while", "on", "by", "is", "are",
  "de", "des", "du", "la", "le", "les", "et", "vos", "votre", "pour", "avec", "en", "au", "aux", "un", "une", "par", "l", "d", "s",
]);

// Texte comparable : sans balises, formules, chiffres, accents ni ponctuation.
function clean(s) {
  return String(s)
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\|[^|;]*:([^;|]*);/g, "$1")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s) => clean(s).split(" ").filter((w) => w && !STOP.has(w));

function similarity(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

// Éléments (anglais, mot français nettoyé) : une résistance ou des dégâts d'un élément précis
const ELEMENTS = [
  ["fire", "feu"], ["cold", "froid"], ["lightning", "foudre"], ["poison", "poison"],
  ["shadow", "ombre"], ["physical", "physiques"],
];

const CONDITIONAL = new Set(["when", "after", "per", "fortified", "power", "pet", "pets", "minion", "minions", "golem", "companion", "companions", "elite", "elites", "shield", "maximum"]);

class AffixMatcher {
  constructor(dict) {
    this.dict = dict;
    this.entries = Object.entries(dict.affixes).map(([key, t]) => ({
      key,
      en: words(t.en),
      fr: words(t.fr),
      enClean: clean(t.en),
      label: clean(t.fr) ? stripTemplate(t.fr) : stripTemplate(t.en),
    }));
    this.cache = new Map();
  }

  // Ligne d'infobulle → { key, score } (meilleure correspondance, toutes langues)
  matchLine(line) {
    if (this.cache.has(line)) return this.cache.get(line);
    const q = words(line);
    let best = { key: null, score: 0 };
    for (const e of this.entries) {
      const s = Math.max(similarity(q, e.fr), similarity(q, e.en));
      if (s > best.score) best = { key: e.key, score: s };
    }
    this.cache.set(line, best);
    return best;
  }

  // Identifiant Mobalytics → clé d'affixe Maxroll, + « famille » : toutes les clés qui expriment
  // la même caractéristique (le jeu a des doublons : « Maximum de vie augmenté de » et
  // « points de vie maximum »), + mots obligatoires (l'élément d'une résistance, etc.).
  matchSlug(slug) {
    const q = slug.replace(/-/g, " ");
    const qw = words(q);
    let best = { key: null, score: 0 };
    for (const e of this.entries) {
      const s = similarity(qw, e.en) + (e.enClean === clean(q) ? 1 : 0);
      if (s > best.score) best = { key: e.key, score: s };
    }
    if (best.score < 0.6) return { key: null, keys: [], must: [], score: best.score };
    const must = ELEMENTS.filter(([en]) => qw.includes(en)).flatMap(([en, fr]) => [en, fr]);
    const core = qw.filter((w) => !ELEMENTS.some(([en]) => en === w));
    const keys = new Set([best.key]);
    if (core.length) {
      for (const e of this.entries) {
        if (!core.every((w) => e.en.includes(w)) || e.en.length > qw.length + 2) continue;
        // Pas les variantes conditionnelles ni celles des familiers / montures / sbires
        if (/^(Pet_|NecroArmy|Mount_|Druid_|Barb_|Necro_|Sorc_|Rogue_|Spiritborn_|Paladin_)/.test(e.key)) continue;
        if (e.en.some((w) => !qw.includes(w) && CONDITIONAL.has(w))) continue;
        keys.add(e.key);
      }
    }
    return { key: best.key, keys: [...keys], must, score: best.score };
  }

  // Famille d'une caractéristique connue par sa clé (imports Maxroll, ajout manuel) ;
  // param = élément (0 physique, 1 feu, 2 foudre, 3 froid, 4 poison, 5 ombre) si la caractéristique en dépend.
  familyOfKey(key, param) {
    const e = this.entries.find((x) => x.key === key);
    const base = e ? this.matchSlug(e.enClean.replace(/\s+/g, "-")) : { keys: [], must: [] };
    const keys = new Set([key, ...base.keys]);
    let must = base.must;
    const dmg = param != null ? this.dict.damageTypes?.[param] : null;
    if (dmg) must = [clean(dmg.en), clean(dmg.fr)].filter(Boolean);
    return { key, keys: [...keys], must, label: this.label(key) + (dmg ? ` (${dmg.fr})` : "") };
  }

  // Toutes les caractéristiques, pour l'éditeur de priorités : [{ key, label }]
  allLabels() {
    const seen = new Set();
    return this.entries
      .filter((e) => !/^(Pet_|NecroArmy|Mount_)/.test(e.key) && e.label && !seen.has(e.label) && seen.add(e.label))
      .map((e) => ({ key: e.key, label: e.label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }

  label(key) {
    return this.entries.find((e) => e.key === key)?.label || key;
  }
}

// Modèle Maxroll → libellé lisible : « +[{value}*100|1%|] de vitesse d'attaque » → « % de vitesse d'attaque »
function stripTemplate(t) {
  return String(t)
    .replace(/\{\/?c[^}]*\}/g, "")
    .replace(/\[[^\]]*%[^\]]*\]/g, "%")
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, "")
    .replace(/\|[^|;]*:([^;|]*);/g, "$1")
    .replace(/\|\d+/g, "")
    .replace(/^\s*[+]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { AffixMatcher, clean, words, similarity };
