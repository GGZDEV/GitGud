// Mises à jour automatiques depuis les versions publiées sur GitHub (Releases).
// Actif seulement dans l'app installée, et si package.json → updates.owner est renseigné.
const { app } = require("electron");

function initUpdater({ onReady, onStatus }) {
  const { owner, repo } = require("../package.json").updates || {};
  if (!app.isPackaged || !owner || !repo) return null;

  const { autoUpdater } = require("electron-updater");
  autoUpdater.setFeedURL({ provider: "github", owner, repo });
  autoUpdater.autoDownload = true; // téléchargée en arrière-plan…
  autoUpdater.autoInstallOnAppQuit = true; // …installée à la fermeture de l'app

  autoUpdater.on("update-available", (i) => onStatus(`Mise à jour ${i.version} en téléchargement…`));
  autoUpdater.on("update-not-available", () => onStatus("GitGud est à jour."));
  autoUpdater.on("update-downloaded", (i) => onReady(i.version));
  autoUpdater.on("error", (err) => onStatus("Mise à jour impossible : " + err.message));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 30 * 1000); // pas au démarrage, pour ne pas ralentir le lancement
  setInterval(check, 6 * 60 * 60 * 1000);

  return { check, installNow: () => autoUpdater.quitAndInstall() };
}

module.exports = { initUpdater };
