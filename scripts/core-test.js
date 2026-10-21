// Tests des briques du cœur, sans Electron ni IA : node scripts/core-test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { TagFilter, stripTags } = require("../src/stream/tags");
const { SentenceSplitter, speechText } = require("../src/stream/sentences");
const { classify } = require("../src/fastlane");
const { Timers, parseTimerCommand } = require("../src/timers");
const { Memory } = require("../src/memory");
const packs = require("../src/games/packs");
const { buildSystemPrompt } = require("../src/personalities");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (err) {
    failed++;
    console.log("FAIL", name, "\n     ", err.message);
  }
}

// Envoie le texte par petits morceaux, comme un flux.
function streamThrough(text, size = 3) {
  const f = new TagFilter();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += f.push(text.slice(i, i + size));
  return { out: out + f.flush(), tags: f.tags };
}

test("balises retirées du flux, même coupées en morceaux", () => {
  const src = 'Va à gauche.<mark x="812" y="440" label="Porte" shape="arrow"/> Puis monte. <memo type="objectif">Veut finir le DLC</memo>';
  for (const size of [1, 2, 3, 7, 50]) {
    const { out, tags } = streamThrough(src, size);
    assert.strictEqual(out, "Va à gauche. Puis monte. ");
    assert.deepStrictEqual(tags.map((t) => t.name), ["mark", "memo"]);
    assert.strictEqual(tags[0].x, "812");
    assert.strictEqual(tags[1].text, "Veut finir le DLC");
  }
});

test("un « < » ordinaire reste du texte", () => {
  assert.strictEqual(streamThrough("PV < 30 % : soigne-toi. <3", 2).out, "PV < 30 % : soigne-toi. <3");
  assert.strictEqual(streamThrough("Utilise <b>vite</b>", 2).out, "Utilise <b>vite</b>");
});

test("balise jamais fermée : rendue telle quelle", () => {
  const { out } = streamThrough("Note <memo>sans fin " + "x".repeat(700), 5);
  assert.ok(out.startsWith("Note <memo>sans fin"));
});

test("stripTags sur une réponse complète", () => {
  const { text, tags } = stripTags('Fonce.\n<timer seconds="300" label="Boss"/>');
  assert.strictEqual(text, "Fonce.");
  assert.strictEqual(tags[0].seconds, "300");
});

test("phrases : la première part vite, les suivantes sont regroupées", () => {
  const s = new SentenceSplitter();
  const got = [];
  const text = "Esquive à droite ! Il frappe deux fois. Puis il saute. Attends la fin du saut pour taper. Garde ton endurance.";
  for (const ch of text) got.push(...s.push(ch));
  got.push(...s.flush());
  assert.strictEqual(got[0], "Esquive à droite !");
  assert.ok(got.length >= 2 && got.length <= 3, JSON.stringify(got));
  assert.strictEqual(got.join(" "), text);
});

test("phrases : le bloc Sources n'est pas lu", () => {
  const s = new SentenceSplitter();
  const got = [...s.push("Prends l'aspect du berserker, il double tes dégâts.\nSources : https://maxroll.gg/x"), ...s.flush()];
  assert.deepStrictEqual(got, ["Prends l'aspect du berserker, il double tes dégâts."]);
});

test("phrases : « 1. » et les liens ne coupent pas", () => {
  assert.strictEqual(speechText("Lis [ce guide](https://a.b/c) **vite**"), "Lis ce guide vite");
  const s = new SentenceSplitter();
  const got = [...s.push("Étape 1. ouvre le menu puis va dans les options. "), ...s.flush()];
  assert.deepStrictEqual(got, ["Étape 1. ouvre le menu puis va dans les options."]);
});

test("voie rapide : questions courtes oui, analyses non", () => {
  for (const q of ["Faiblesse de ce boss ?", "C'est quoi cet objet ?", "Je vais où maintenant ?", "what does this rune do"]) assert.strictEqual(classify(q), "fast", q);
  for (const q of ["Pourquoi je meurs tout le temps ?", "Quel est le meilleur build nécromancien cette saison ?", "Compare ces deux armes", "Explique la mécanique du boss", "Analyse mes dernières parties"]) assert.strictEqual(classify(q), "deep", q);
  assert.strictEqual(classify("Est-ce que je dois garder cet anneau ou plutôt celui que je porte déjà sur mon personnage principal"), "deep");
});

test("minuteurs : commandes reconnues", () => {
  assert.deepStrictEqual(parseTimerCommand("minuteur 5 minutes boss"), { action: "start", seconds: 300, label: "Boss" });
  assert.strictEqual(parseTimerCommand("Rappelle-moi dans 30 secondes de relancer la potion").seconds, 30);
  assert.strictEqual(parseTimerCommand("Rappelle-moi dans 30 secondes de relancer la potion").label, "Relancer potion");
  assert.strictEqual(parseTimerCommand("mets un timer de deux minutes et demie").seconds, 150);
  assert.strictEqual(parseTimerCommand("set a timer for 90 seconds").seconds, 90);
  assert.deepStrictEqual(parseTimerCommand("annule le minuteur"), { action: "cancel", label: null });
  const presets = [{ name: "Roshan", aliases: ["rosh"], seconds: 480 }];
  assert.deepStrictEqual(parseTimerCommand("lance rosh", presets), { action: "start", seconds: 480, label: "Roshan" });
});

test("minuteurs : les vraies questions ne lancent rien", () => {
  for (const q of ["Combien dure le timer de Roshan ?", "C'est quoi le meilleur build", "Rappelle-moi pourquoi je fais ça", "Faiblesse de ce boss ?"]) {
    assert.strictEqual(parseTimerCommand(q, [{ name: "Roshan", seconds: 480 }]), null, q);
  }
});

test("minuteurs : échéance et annulation", async () => {
  const t = new Timers();
  t.start(100, "A");
  t.start(200, "Boss final");
  assert.strictEqual(t.cancel("boss"), 1);
  assert.deepStrictEqual(t.view().map((x) => x.label), ["A"]);
  t.dispose();
});

test("mémoire : faits, doublons, oubli, contexte", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitgud-mem-"));
  const m = new Memory(dir);
  m.logQuestion("elden-ring", "Elden Ring", "Comment battre Malenia ?");
  m.remember("elden-ring", "Elden Ring", { type: "difficulte", text: "Meurt souvent contre Malenia à cause de Danse de l'oiseau" });
  m.remember("elden-ring", "Elden Ring", { type: "difficulte", text: "Meurt souvent contre Malenia à cause de la Danse de l'oiseau" });
  m.remember("elden-ring", "Elden Ring", { type: "objectif", text: "Veut finir Shadow of the Erdtree" });
  m.remember("elden-ring", "Elden Ring", { type: "preference", text: "Préfère les builds mêlée" });
  const again = new Memory(dir); // relu depuis le disque
  const er = again.list().find((g) => g.key === "elden-ring");
  assert.strictEqual(er.facts.length, 2, JSON.stringify(er.facts));
  assert.strictEqual(er.facts.find((f) => f.kind === "difficulte").count, 2);
  const ctx = again.context("elden-ring");
  assert.ok(ctx.includes("Objectif : Veut finir Shadow of the Erdtree"), ctx);
  assert.ok(ctx.includes("Préférence : Préfère les builds mêlée"), ctx); // profil global
  assert.ok(ctx.includes("(noté 2 fois)"), ctx);
  assert.strictEqual(again.forget("elden-ring", "Shadow of the Erdtree"), 1);
  assert.ok(!again.context("elden-ring").includes("Erdtree"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("modules JSON fournis : tous valides, jeux reconnus", () => {
  const { games, errors } = packs.load(true);
  assert.deepStrictEqual(errors, []);
  const find = (title) => games.find((g) => g.match.test(title))?.id;
  assert.strictEqual(find("ELDEN RING™"), "elden-ring");
  assert.strictEqual(find("Baldur's Gate 3 (1920x1080) - (DX11)"), "baldurs-gate-3");
  assert.strictEqual(find("Path of Exile 2"), "path-of-exile-2");
  assert.strictEqual(find("Dota 2"), "dota-2");
  assert.strictEqual(games.find((g) => g.id === "dota-2").timers.length, 3);
});

test("modules JSON perso : remplacement et erreurs signalées", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitgud-packs-"));
  fs.writeFileSync(path.join(dir, "er.json"), JSON.stringify({ id: "elden-ring", name: "Elden Ring (perso)", match: "elden" }));
  fs.writeFileSync(path.join(dir, "bad.json"), "{ pas du json");
  fs.writeFileSync(path.join(dir, "noid.json"), JSON.stringify({ name: "X", match: "x" }));
  packs.configure({ user: dir });
  const { games, errors } = packs.load(true);
  assert.strictEqual(games.find((g) => g.id === "elden-ring").name, "Elden Ring (perso)");
  assert.strictEqual(errors.length, 2, JSON.stringify(errors));
  packs.configure({ user: path.join(dir, "absent") });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("prompt système stable et balises annoncées", () => {
  const a = buildSystemPrompt("slime", "fr", { memory: true, annotations: true, timers: true });
  assert.strictEqual(a, buildSystemPrompt("slime", "fr", { memory: true, annotations: true, timers: true }));
  assert.ok(a.includes("<memo") && a.includes("<mark") && a.includes("<timer"));
  assert.ok(!buildSystemPrompt("slime", "fr", {}).includes("<memo"));
});

console.log(failed ? `\n${failed} échec(s)` : "\nTout est vert.");
process.exit(failed ? 1 : 0);
