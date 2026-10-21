// Intégrations par jeu : détection du jeu en cours, consignes de recherche et données en direct.
// Deux façons d'ajouter un jeu :
//   - un module JSON (src/games/packs/ ou %APPDATA%/gitgud/games/), sans code : voir packs/README.md ;
//   - un module JS { id, name, match, guidance, context?, timers? } dans ce dossier, pour les
//     intégrations poussées (Deadlock, Diablo IV).
const packs = require("./packs");

const BUILTIN = [require("./deadlock"), require("./diablo4")];

// Les modules JS passent avant les modules JSON du même jeu.
function allGames() {
  const ids = new Set(BUILTIN.map((g) => g.id));
  return [...BUILTIN, ...packs.load().games.filter((g) => !ids.has(g.id))];
}

// Jeu en cours d'après la fenêtre observée, puis les fenêtres ouvertes (cas « Écran entier »).
function detectGame(targetName, openWindows = []) {
  const games = allGames();
  for (const name of [targetName, ...openWindows]) {
    const game = name && games.find((g) => g.match.test(name));
    if (game) return game;
  }
  return null;
}

// Bloc de contexte à joindre à la question. Les données en direct ont 4 s maximum :
// une API lente ne doit jamais retarder la réponse.
async function gameContext(game, { question, settings }) {
  if (!game) return "";
  let data = "";
  if (game.context) {
    try {
      data = await Promise.race([
        game.context({ question, settings }),
        new Promise((resolve) => setTimeout(() => resolve(""), 4000)),
      ]);
    } catch (err) {
      console.warn(`${game.name} :`, err.message);
    }
  }
  return [game.guidance, data].filter(Boolean).join("\n\n");
}

// Pour les paramètres : modules chargés et erreurs de format
function listGames() {
  const { errors } = packs.load(true);
  return {
    games: allGames().map((g) => ({ id: g.id, name: g.name, origin: g.origin || "intégré (code)", live: g.live ?? !!g.context, timers: (g.timers || []).length, ...(g.pack || {}) })),
    errors,
    userDir: packs.userDir,
  };
}

module.exports = { allGames, detectGame, gameContext, listGames, configurePacks: packs.configure };
