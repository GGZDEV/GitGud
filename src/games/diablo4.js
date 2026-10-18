// Diablo IV : pas d'API publique fiable (builds, minuteurs d'événements). On oriente donc
// la recherche web vers les références de la communauté, en exigeant la saison en cours et
// des sources citées. Un lien de build Maxroll / D4Builds collé dans la question est analysé.
module.exports = {
  id: "diablo4",
  name: "Diablo IV",
  match: /\bdiablo\s*(iv|4)\b/i,
  guidance:
    "Jeu : Diablo IV. Les builds, la méta et les objets changent à chaque saison : vérifie d'abord la saison et le patch en cours " +
    "(news.blizzard.com), puis cherche en priorité sur maxroll.gg, d4builds.gg et mobalytics.gg/diablo-4. " +
    "Utilise les noms français des compétences et objets s'ils existent. " +
    "Si le joueur colle un lien de build (Maxroll, D4Builds, Mobalytics), ouvre-le et appuie ta réponse dessus. " +
    "Termine par une ligne « Sources : » avec les liens utilisés.",
};
