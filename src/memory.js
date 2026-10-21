// Mémoire du joueur entre les sessions, par jeu : objectifs, progression, difficultés
// récurrentes, préférences. Tout reste en local (%APPDATA%/gitgud/memory.json).
//
// Les faits viennent de l'IA elle-même (balise <memo> dans sa réponse, sans appel en plus) ;
// les dernières questions sont aussi gardées pour qu'elle repère ce qui revient souvent.
const fs = require("fs");
const path = require("path");

const KINDS = { objectif: "Objectif", progression: "Progression", difficulte: "Difficulté récurrente", preference: "Préférence", info: "À savoir" };
const MAX_FACTS = 40; // par jeu
const MAX_QUESTIONS = 30; // par jeu
const GLOBAL = "_global"; // faits valables pour tous les jeux (préférences du joueur)

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function kindOf(type) {
  const t = norm(type);
  if (/obj|goal/.test(t)) return "objectif";
  if (/prog|niveau|level/.test(t)) return "progression";
  if (/diff|erreur|faibl|mort|pattern|weak/.test(t)) return "difficulte";
  if (/pref|style/.test(t)) return "preference";
  return "info";
}

// Deux faits disent-ils la même chose ? (mots en commun)
function similar(a, b) {
  const wa = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return norm(a) === norm(b);
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size) >= 0.7;
}

function ago(ts, now = Date.now()) {
  const d = Math.floor((now - ts) / 86400000);
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return "hier";
  if (d < 30) return `il y a ${d} jours`;
  return `il y a ${Math.round(d / 30)} mois`;
}

class Memory {
  constructor(dataDir) {
    this.file = path.join(dataDir, "memory.json");
    this.data = { games: {} };
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!this.data.games) this.data.games = {};
    } catch {}
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.warn("Mémoire :", err.message);
    }
  }

  game(key) {
    const k = key || GLOBAL;
    if (!this.data.games[k]) this.data.games[k] = { name: k, facts: [], questions: [], lastSeen: 0, sessions: 0 };
    return this.data.games[k];
  }

  // Ajoute ou met à jour un fait ; renvoie le fait enregistré.
  remember(gameKey, gameName, { type, text }) {
    text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!text) return null;
    const kind = kindOf(type);
    const g = this.game(kind === "preference" ? GLOBAL : gameKey);
    if (gameName && g !== this.data.games[GLOBAL]) g.name = gameName;
    const same = g.facts.find((f) => similar(f.text, text));
    const now = Date.now();
    if (same) {
      Object.assign(same, { text, kind, at: now, count: (same.count || 1) + 1 });
    } else {
      g.facts.push({ id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, text, at: now, count: 1 });
    }
    // Trop de faits : on oublie les plus anciens, sauf les objectifs
    while (g.facts.length > MAX_FACTS) {
      const old = [...g.facts].sort((a, b) => (a.kind === "objectif") - (b.kind === "objectif") || a.at - b.at)[0];
      g.facts = g.facts.filter((f) => f !== old);
    }
    this.save();
    return same || g.facts[g.facts.length - 1];
  }

  // Oublie les faits qui correspondent au texte (dans le jeu et dans le profil global).
  forget(gameKey, text) {
    let n = 0;
    for (const k of [gameKey || GLOBAL, GLOBAL]) {
      const g = this.data.games[k];
      if (!g) continue;
      const before = g.facts.length;
      g.facts = g.facts.filter((f) => !(similar(f.text, text) || norm(f.text).includes(norm(text))));
      n += before - g.facts.length;
    }
    if (n) this.save();
    return n;
  }

  // Note la question posée ; une nouvelle session commence après 2 h sans question.
  logQuestion(gameKey, gameName, question) {
    const g = this.game(gameKey);
    if (gameName) g.name = gameName;
    const now = Date.now();
    if (now - (g.lastSeen || 0) > 2 * 3600 * 1000) {
      g.previousSession = g.lastSeen || 0;
      g.sessionStart = now;
      g.sessions = (g.sessions || 0) + 1;
    }
    g.lastSeen = now;
    g.questions.push({ q: String(question).slice(0, 160), at: now });
    g.questions = g.questions.slice(-MAX_QUESTIONS);
    this.save();
  }

  // Bloc de contexte pour l'IA : ce qu'on sait du joueur sur ce jeu.
  context(gameKey, now = Date.now()) {
    const g = this.data.games[gameKey || GLOBAL];
    const global = this.data.games[GLOBAL];
    const facts = [...(g?.facts || []), ...(gameKey && global ? global.facts : [])];
    const lines = [];
    if (facts.length) {
      const order = Object.keys(KINDS);
      facts.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.at - a.at);
      for (const f of facts.slice(0, 18)) lines.push(`- ${KINDS[f.kind]} : ${f.text}${f.count > 1 ? ` (noté ${f.count} fois)` : ""} — ${ago(f.at, now)}`);
    }
    // Questions des sessions précédentes : pour repérer ce qui revient
    const past = (g?.questions || []).filter((x) => now - x.at > 30 * 60 * 1000).slice(-8);
    if (past.length) lines.push(`- Questions des sessions précédentes : ${past.map((x) => `« ${x.q} » (${ago(x.at, now)})`).join(" ; ")}`);
    const inSession = (g?.questions || []).filter((x) => x.at >= (g.sessionStart || 0)).length;
    if (g?.previousSession && inSession <= 1) lines.push(`- Dernière session sur ce jeu : ${ago(g.previousSession, now)}.`);
    return lines.length ? `Ce que tu sais déjà du joueur (mémoire locale de GitGud) :\n${lines.join("\n")}` : "";
  }

  // Pour les paramètres : faits par jeu
  list() {
    return Object.entries(this.data.games)
      .map(([key, g]) => ({ key, name: key === GLOBAL ? "Tous les jeux" : g.name || key, facts: g.facts.map(({ id, kind, text, at, count }) => ({ id, kind, label: KINDS[kind], text, at, count })), questions: g.questions.length }))
      .filter((g) => g.facts.length || g.questions);
  }

  deleteFact(id) {
    for (const g of Object.values(this.data.games)) g.facts = g.facts.filter((f) => f.id !== id);
    this.save();
  }

  clear(gameKey) {
    if (gameKey) delete this.data.games[gameKey];
    else this.data.games = {};
    this.save();
  }
}

module.exports = { Memory, KINDS, GLOBAL };
