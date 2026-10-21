// Voie rapide : les questions courtes et factuelles (« faiblesse de ce boss ? », « c'est quoi
// cet objet ? ») partent vers un modèle léger, sans recherche web, pour un premier mot en ~2 s.
// Les analyses (build, stratégie, méta, patch, comparaison…) gardent le moteur complet.

// Demandes qui méritent le moteur complet (réflexion, infos à jour, recherche web).
const DEEP = new RegExp(
  [
    "build", "analys", "compar", "explique", "expliquer", "pourquoi", "strat[ée]g", "optimi", "guide", "[ée]tapes?",
    "planifi", "tier ?list", "m[ée]ta\\b", "patch", "saison", "nerf", "buff", "mise [àa] jour", "derni[eè]res? parties",
    "historique", "mes stats", "d[ée]taill", "en d[ée]tail", "r[ée]sume", "conseils?", "am[ée]liorer", "progresser",
    "why", "explain", "strategy", "compare", "analy[sz]e", "tier list", "guide", "step", "patch", "season", "improve",
    "https?://",
  ].join("|"),
  "i",
);

const MAX_WORDS = 14;
const MAX_CHARS = 110;

// "fast" ou "deep"
function classify(question) {
  const q = String(question || "").trim();
  if (!q) return "deep";
  const words = q.split(/\s+/).length;
  if (words > MAX_WORDS || q.length > MAX_CHARS) return "deep";
  if (DEEP.test(q)) return "deep";
  return "fast";
}

module.exports = { classify };
