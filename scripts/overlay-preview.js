// Capture l'overlay dans différents états, pour vérifier le rendu sans lancer de jeu.
// Usage : npx electron scripts/overlay-preview.js <dossier-de-sortie>
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const out = process.argv.find((a, i) => i > 1 && !a.endsWith(".js")) || path.join(__dirname, "..", "build", "preview");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = [
  { file: "1-ecoute-kin", mascot: "slime", events: [["state", "listening"]] },
  {
    file: "2-reflexion-axiom",
    mascot: "mech",
    events: [["user-text", "Je prends quoi comme arme pour ce boss ?"], ["state", "thinking"]],
  },
  {
    file: "3-reponse-gremlin",
    mascot: "wolf",
    events: [
      ["user-text", "Tu partirais sur lequel pour ce build ?"],
      ["assistant-done", "Le second, évidemment. Il renforce ta compétence principale tout de suite, sans dépendre d'une condition rare. Le premier, c'est pour les gens qui aiment perdre."],
      ["state", "speaking"],
    ],
  },
  {
    file: "4-reponse-razor",
    mascot: "orc",
    events: [["user-text", "Je fais quoi là ?"], ["assistant-done", "Recule derrière le mur. Soigne-toi. Ensuite, flanc gauche."], ["state", "idle"]],
  },
  {
    file: "6-sources-razor",
    mascot: "lich",
    events: [
      ["user-text", "Je prends quoi contre Haze avec Infernus ?"],
      ["assistant-done", "Pyroalchimie en milieu de partie : 60 % de victoires contre elle. Ensuite Fléau.\n\nSources : https://deadlock-api.com, https://deadlock.wiki/Infernus"],
      ["state", "idle"],
    ],
  },
  {
    file: "7-compact-kin",
    mascot: "slime",
    config: { compact: true, opacity: 0.75 },
    events: [["user-text", "On fait quoi ?"], ["assistant-done", "Recule derrière le mur, soigne-toi, puis attaque par le flanc gauche quand leur tank a utilisé son bouclier."], ["state", "speaking"]],
  },
  {
    file: "8-diablo-fiche",
    mascot: "wraith",
    events: () => [["d4-item", require("../build/d4/card-payload.json")]],
  },
  {
    file: "5-zenith-erreur",
    mascot: "wraith",
    events: [["state", "idle"], ["error", "Codex n'est pas connecté. Reconnecte-toi depuis l'assistant de configuration."]],
  },
];

app.on("window-all-closed", () => {}); // on ferme chaque fenêtre entre deux scènes

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  let mascot = "slime";
  const { PERSONALITIES } = require("../src/personalities");
  ipcMain.handle("overlay:config", () => ({ mascot, name: PERSONALITIES[mascot].name, version: require("../package.json").version, autoHideSeconds: 0, context: "Path of Exile 2" }));
  ipcMain.on("tray:icon", (_e, url) => fs.writeFileSync(path.join(out, `icone-${mascot}.png`), Buffer.from(url.split(",")[1], "base64")));

  for (const scene of SCENES) {
    mascot = scene.mascot || "slime";
    const win = new BrowserWindow({
      width: 440,
      height: 520,
      // Une fenêtre cachée ne se repeint pas : on l'affiche hors de l'écran.
      x: -3000, y: 0, skipTaskbar: true,
      backgroundColor: "#1d2a24", // fond « jeu » sombre pour juger le contraste
      webPreferences: { preload: path.join(__dirname, "..", "preload.js"), backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, "..", "src", "overlay.html"));
    await wait(300);
    if (scene.config) win.webContents.send("config", scene.config);
    const events = typeof scene.events === "function" ? scene.events() : scene.events;
    for (const [channel, payload] of events) win.webContents.send(channel, payload);
    await wait(700);
    fs.writeFileSync(path.join(out, scene.file + ".png"), (await win.webContents.capturePage()).toPNG());
    win.destroy();
  }
  console.log("Captures dans", out);
  app.quit();
});
