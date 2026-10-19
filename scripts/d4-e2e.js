// Test de bout en bout du module Diablo IV dans l'app réelle, sans le jeu :
// profil de test (build importé + gants portés), puis un « faux jeu » envoie une infobulle
// par le tube nommé, comme la DLL du lecteur d'écran. Capture l'overlay obtenu.
// Usage : npx electron scripts/d4-e2e.js <dossier-profil> <capture.png>
const path = require("path");
const fs = require("fs");
const [profile, out] = process.argv.slice(-2);
process.env.GAMEHELPER_DATA = profile;

const build = require("../build/d4/test-build.json");
const endgame = build.variants.find((v) => v.name === "Endgame");
const { app, BrowserWindow } = require("electron");

// Profil de test
fs.mkdirSync(path.join(profile, "d4"), { recursive: true });
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ setupDone: true, mascot: "lich", voiceEnabled: false }));
const equippedGloves = {
  name: "POIGNES DU CRÉPUSCULE", typeLine: "Gants ancestraux légendaires", slot: "gloves", rarity: "legendary", power: 800,
  implicits: [], tempered: [], lostWhenEquipped: [], hasComparison: false,
  affixes: [
    { text: "+96 dextérité [86 - 100]", key: "Dexterity", value: 96, min: 86, max: 100 },
    { text: "+11,5 % de chances d’infliger un coup critique [8 - 14] %", key: "Crit_Percent_Bonus", value: 11.5, min: 8, max: 14 },
    { text: "Multiplicateur de dégâts sur la durée : x18 % [12 - 20] %", key: "Bucketed_Multiplicative_DoT_Damage", value: 18, min: 12, max: 20 },
    { text: "+7,2 % à la vitesse d’attaque [5 - 9] %", key: "Attack_Speed_Percent_Bonus", value: 7.2, min: 5, max: 9 },
  ],
};
fs.writeFileSync(path.join(profile, "d4", "state.json"), JSON.stringify({ build, variantId: endgame.id, equipped: { gloves: equippedGloves }, positions: { inventory: null, equip: {} }, inventory: [] }));

require(path.join(__dirname, "..", "main.js"));

const TOOLTIP = [
  "Interface", "Inventaire",
  "PRISE DE LA PESTILENCE", "Gants ancestraux légendaires", "800 Puissance de l'objet",
  "910 Armure",
  "+99 dextérité [86 - 100]",
  "Multiplicateur de dégâts contre les cibles vulnérables : x17 % [12 - 20] %",
  "Multiplicateur de dégâts sur la durée : x19,5 % [12 - 20] %",
  "+8,5 % à la vitesse d’attaque [5 - 9] %",
  "Vos attaques de base infligent 25 % de dégâts de poison supplémentaires pendant 4 secondes.",
  "Propriétés perdues si équipé :", "+11,5 % de chances d’infliger un coup critique",
  "Prix de vente : 61 802 or", "Requiert le niveau 60", "Bouton droit de la souris",
];

app.whenReady().then(() =>
  setTimeout(async () => {
    const fd = fs.openSync("\\\\.\\pipe\\d4lf", "w");
    fs.writeSync(fd, "CONNECTED");
    for (const l of TOOLTIP) fs.writeSync(fd, Buffer.from(l, "utf8"));
    await new Promise((r) => setTimeout(r, 1500));
    const overlay = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("overlay.html"));
    fs.writeFileSync(out, (await overlay.webContents.capturePage()).toPNG());
    console.log("overlay visible :", overlay.isVisible(), "→", out);
    fs.writeSync(fd, "DISCONNECTED");
    fs.closeSync(fd);
    app.quit();
  }, 5000)
);
