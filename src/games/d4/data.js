// Données de jeu Diablo IV (textes FR/EN des affixes, types d'objets, uniques, compétences),
// tirées des fichiers publics de Maxroll puis réduites à un petit dictionnaire mis en cache
// une semaine dans le dossier de l'app.
const fs = require("fs");
const path = require("path");

const BASE = "https://assets-ng.maxroll.gg/d4-tools/game";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const VERSION = 4; // à augmenter quand le contenu du dictionnaire change

let dict = null;
let loading = null;

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "GameHelper" } });
  if (!res.ok) throw new Error(`Maxroll : ${res.status} (${url})`);
  return res.json();
}

// « [fs]Amulette » → « Amulette » (Maxroll préfixe le genre grammatical)
const stripGender = (s) => String(s || "").replace(/^\[[a-z]+\]/i, "").trim();

async function build() {
  const [en, fr, min] = await Promise.all([
    getJson(`${BASE}/data.enus.json?latest`),
    getJson(`${BASE}/data.frfr.json?latest`),
    getJson(`${BASE}/data.min.json?latest`),
  ]);
  const pick = (a, b, map) => {
    const out = {};
    for (const k of Object.keys(a || {})) if (b?.[k]) out[k] = map(a[k], b[k]);
    return out;
  };
  // Affixes Maxroll (identifiant numérique des planificateurs) → caractéristique(s) du jeu
  const maxrollAffixes = {};
  for (const [key, a] of Object.entries(min.affixes || {})) {
    maxrollAffixes[a.id] = { key, attrs: (a.attributes || []).map((x) => ({ name: min.attributes?.[x.id]?.name, param: x.param })) };
  }
  // Aspects légendaires : suffixe du nom (« de pestilence ») présent dans le nom de l'objet
  const aspects = {};
  for (const [key, a] of Object.entries(en.affixes || {})) {
    const f = fr.affixes?.[key];
    if (!/^(legendary_|aspect)/i.test(key) || !f) continue;
    // Nom anglais : « of Pestilence » (suffixe) ou « Exploiter's » (préfixe) ; idem en français
    const enName = a?.suffix || a?.prefix;
    const frName = f.suffix || f.prefix;
    // « vulpin[fs]vulpine[mp]vulpins[fp]vulpines » : formes accordées en genre et en nombre
    const frForms = String(frName).split(/\[[a-z]+\]/i).map((x) => x.trim()).filter(Boolean);
    if (enName && frForms.length) aspects[key] = { en: enName, fr: frForms[0], frForms, enPrefix: a?.prefix || null };
  }
  return {
    version: VERSION,
    builtAt: Date.now(),
    maxrollAffixes,
    aspects,
    damageTypes: pick(en.uiStrings?.damageType, fr.uiStrings?.damageType, (a, b) => ({ en: a, fr: b })),
    // Modèles de texte d'affixes : { clé: { en, fr } }
    affixes: pick(en.attributeDescriptions, fr.attributeDescriptions, (a, b) => ({ en: a, fr: b })),
    itemTypes: pick(en.itemTypes, fr.itemTypes, (a, b) => ({ en: stripGender(a.name), fr: stripGender(b.name) })),
    uniques: pick(en.items, fr.items, (a, b) => ({ en: a.name, fr: stripGender(b.name) })),
    skills: pick(en.skills, fr.skills, (a, b) => ({ en: a.name, fr: stripGender(b.name) })),
    resources: pick(en.uiStrings?.resourceType, fr.uiStrings?.resourceType, (a, b) => ({ en: a, fr: b })),
  };
}

// Retourne le dictionnaire (cache disque, rafraîchi chaque semaine ; ancien cache si hors ligne).
async function getDict(dataDir) {
  if (dict) return dict;
  if (loading) return loading;
  const file = path.join(dataDir, "d4", "dict.json");
  loading = (async () => {
    let cached = null;
    try {
      cached = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    if (cached && cached.version === VERSION && Date.now() - cached.builtAt < MAX_AGE) return (dict = cached);
    try {
      const fresh = await build();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(fresh));
      return (dict = fresh);
    } catch (err) {
      if (cached) return (dict = cached);
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

module.exports = { getDict };
