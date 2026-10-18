// Configuration de build : celle de package.json, + publication GitHub (fichier latest.yml
// nécessaire aux mises à jour automatiques) quand updates.owner est renseigné.
const pkg = require("./package.json");

const { owner, repo } = pkg.updates || {};
module.exports = {
  ...pkg.build,
  ...(owner && repo ? { publish: [{ provider: "github", owner, repo }] } : {}),
};
