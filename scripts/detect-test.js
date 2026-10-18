// Affiche ce que GameHelper détecte sur la machine : npx electron scripts/detect-test.js
const { app } = require("electron");
const { detectAll } = require("../src/setup/detect");

app.whenReady().then(async () => {
  const t = Date.now();
  console.log(JSON.stringify(await detectAll(), null, 2));
  console.log(`détection : ${((Date.now() - t) / 1000).toFixed(1)} s`);
  app.quit();
});
