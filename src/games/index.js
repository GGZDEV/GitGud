// Intégrations par jeu : détection du jeu en cours, consignes de recherche et données en direct.
// Pour ajouter un jeu : un module { id, name, match, guidance, context? } dans ce dossier.
const GAMES = [require("./deadlock"), require("./diablo4")];

// Jeu en cours d'après la fenêtre observée, puis les fenêtres ouvertes (cas « Écran entier »).
function detectGame(targetName, openWindows = []) {
  for (const name of [targetName, ...openWindows]) {
    const game = name && GAMES.find((g) => g.match.test(name));
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

module.exports = { GAMES, detectGame, gameContext };
