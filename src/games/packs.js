// Modules de jeu en JSON : n'importe qui peut ajouter un jeu sans toucher au code.
// Emplacements, du moins au plus prioritaire (un même « id » remplace le précédent) :
//   src/games/packs/*.json             fournis avec GitGud
//   %APPDATA%/gitgud/games/*.json      ajoutés par le joueur ou la communauté
// Format : voir src/games/packs/README.md
const fs = require("fs");
const path = require("path");

const RELOAD_MS = 5000; // relit les dossiers au plus toutes les 5 s (modifications à chaud)
const FETCH_TTL = 30 * 60 * 1000;

let builtinDir = path.join(__dirname, "packs");
let userDir = null;
let loaded = { at: 0, games: [], errors: [] };
const fetchCache = new Map();

function configure({ user, builtin } = {}) {
  if (user) userDir = user;
  if (builtin) builtinDir = builtin;
  loaded.at = 0;
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function regex(src, flags = "i") {
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

// Valide un module ; renvoie { game } ou { error }.
function compile(raw, file) {
  const where = path.basename(file);
  if (!raw || typeof raw !== "object") return { error: `${where} : ce n'est pas un objet JSON` };
  const id = String(raw.id || "").trim();
  const name = String(raw.name || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return { error: `${where} : « id » manquant ou invalide (minuscules, chiffres et tirets)` };
  if (!name) return { error: `${where} : « name » manquant` };
  const patterns = asList(raw.match).map((m) => regex(m));
  if (!patterns.length || patterns.some((p) => !p)) return { error: `${where} : « match » doit contenir une ou plusieurs expressions valides` };

  const keywords = asList(raw.keywords)
    .map((k) => ({ when: regex(k.when), say: String(k.say || "") }))
    .filter((k) => k.when && k.say);
  const data = asList(raw.data)
    .filter((d) => /^https:\/\//i.test(d.url || ""))
    .map((d) => ({ url: d.url, when: d.when ? regex(d.when) : null, label: d.label || d.url, pick: d.pick || "", ttl: (Number(d.ttl) || 0) * 1000 || FETCH_TTL, maxChars: Math.min(Number(d.maxChars) || 1500, 6000) }));
  const timers = asList(raw.timers)
    .filter((t) => t && t.name && Number(t.seconds) > 0)
    .map((t) => ({ name: String(t.name), aliases: asList(t.aliases).map(String), seconds: Number(t.seconds) }));

  const lines = [`Jeu : ${name}.`];
  if (raw.guidance) lines.push(String(raw.guidance));
  const sources = asList(raw.sources).map(String).filter(Boolean);
  if (sources.length) lines.push(`Pour la recherche web, privilégie : ${sources.join(", ")}. Termine par une ligne « Sources : » avec les liens utilisés.`);
  const facts = asList(raw.facts).map(String).filter(Boolean);
  if (facts.length) lines.push(`À savoir sur ce jeu :\n${facts.map((f) => `- ${f}`).join("\n")}`);
  const glossary = Object.entries(raw.glossary || {});
  if (glossary.length) lines.push(`Vocabulaire du jeu : ${glossary.map(([k, v]) => `${k} = ${v}`).join(" ; ")}.`);

  const game = {
    id,
    name,
    match: { test: (s) => patterns.some((p) => p.test(s)) },
    guidance: lines.join("\n"),
    timers,
    live: data.length > 0,
    pack: { file, author: raw.author || "", version: raw.version || "", description: raw.description || "" },
  };
  if (keywords.length || data.length) game.context = ({ question }) => packContext({ keywords, data }, question);
  return { game };
}

function pick(obj, dotted) {
  if (!dotted) return obj;
  return dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

async function fetchData(d) {
  const hit = fetchCache.get(d.url);
  if (hit && Date.now() - hit.at < d.ttl) return hit.text;
  const res = await fetch(d.url, { headers: { "User-Agent": "GitGud", Accept: "application/json, text/plain" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status}`);
  const body = await res.text();
  let text = body;
  try {
    const value = pick(JSON.parse(body), d.pick);
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {}
  text = String(text || "").replace(/\s+/g, " ").slice(0, d.maxChars);
  fetchCache.set(d.url, { at: Date.now(), text });
  return text;
}

async function packContext({ keywords, data }, question) {
  const out = keywords.filter((k) => k.when.test(question)).map((k) => k.say);
  const wanted = data.filter((d) => !d.when || d.when.test(question));
  const results = await Promise.allSettled(wanted.map(fetchData));
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) out.push(`Données « ${wanted[i].label} » (${new URL(wanted[i].url).hostname}) : ${r.value}`);
  });
  return out.join("\n");
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json")).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function load(force = false) {
  if (!force && Date.now() - loaded.at < RELOAD_MS) return loaded;
  const byId = new Map();
  const errors = [];
  for (const [origin, dir] of [["intégré", builtinDir], ["perso", userDir]]) {
    if (!dir) continue;
    for (const file of readDir(dir)) {
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
      } catch (err) {
        errors.push(`${path.basename(file)} : JSON invalide (${err.message})`);
        continue;
      }
      const { game, error } = compile(raw, file);
      if (error) errors.push(error);
      else byId.set(game.id, { ...game, origin });
    }
  }
  loaded = { at: Date.now(), games: [...byId.values()], errors };
  return loaded;
}

module.exports = { configure, load, compile, get userDir() { return userDir; } };
