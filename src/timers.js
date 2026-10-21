// Minuteurs : « minuteur 5 minutes boss », « rappelle-moi dans 30 secondes de relancer »,
// « annule le minuteur ». Reconnus en local, sans IA : le minuteur démarre instantanément.
// L'IA peut aussi en lancer un avec la balise <timer seconds="…" label="…"/>.
const { EventEmitter } = require("events");

const NUMBERS = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30,
};
const UNIT = "(secondes?|sec|s|minutes?|mins?|mn|m|heures?|h|seconds?|hours?)";
const NUM = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMBERS).join("|")})(?:\\s*(?:et\\s*)?(demie?|half))?`;
// « 2 minutes et demie » : la demie peut venir avant ou après l'unité
const DURATION = new RegExp(`\\b${NUM}\\s*${UNIT}\\b(?:\\s+et\\s+(demie?))?`, "i");
const TRIGGER = /\b(minuteur|timer|chrono|compte [àa] rebours|rappelle[- ]?moi|pr[ée]viens[- ]?moi|remind me|set a timer)\b/i;
const CANCEL = /\b(annule|arr[êe]te|stoppe?|supprime|enl[èe]ve|cancel|stop|clear)\b.*\b(minuteurs?|timers?|chronos?|rappels?)\b/i;
const STARTER = /^\s*(lance|d[ée]marre|start|go)\b/i;
const QUESTION = /^\s*(c'est quoi|combien|comment|quand|pourquoi|est-ce|quel(le)?s?|what|how|when|why)\b/i;

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function seconds(numText, half, unit) {
  let n = Number(String(numText).replace(",", ".")) || NUMBERS[numText.toLowerCase()] || 0;
  if (half) n += 0.5;
  const u = unit.toLowerCase();
  if (/^h/.test(u)) return n * 3600;
  if (/^(s|sec)/.test(u)) return n;
  return n * 60;
}

// Libellé : ce qui reste une fois retirés le déclencheur et la durée.
function labelOf(q, durationText) {
  const label = q
    .replace(durationText, " ")
    .replace(TRIGGER, " ")
    .replace(/\b(lance|d[ée]marre|mets?|met|un|une|le|la|les|dans|pour|de|d'|du|des|qu'il|que|faut|start|a|for|in|to|me|stp|s'il te pla[iî]t)\b/gi, " ")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label ? label[0].toUpperCase() + label.slice(1, 32) : "Minuteur";
}

// presets : [{ name, aliases?, seconds }] fournis par le module du jeu (ex. réapparition d'un boss)
// → { action: "start", seconds, label } | { action: "cancel", label? } | null
function parseTimerCommand(question, presets = []) {
  const q = String(question || "").trim();
  if (!q || q.split(/\s+/).length > 16) return null;
  if (CANCEL.test(q)) {
    const label = q.replace(CANCEL, " ").replace(/\b(le|la|les|du|de|tous|all|the)\b/gi, " ").replace(/[?!.,]+/g, "").trim();
    return { action: "cancel", label: label || null };
  }
  // « combien dure le timer de Roshan ? » est une question, pas une commande
  if (QUESTION.test(q)) return null;
  const nq = norm(q);
  const hasTrigger = STARTER.test(q) || /^\s*(minuteur|timer|chrono)\b/i.test(q);
  for (const p of presets) {
    const names = [p.name, ...(p.aliases || [])].map(norm);
    if (hasTrigger && names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(nq))) {
      return { action: "start", seconds: p.seconds, label: p.name };
    }
  }
  if (!TRIGGER.test(q)) return null;
  const d = q.match(DURATION);
  if (!d) return null;
  const s = seconds(d[1], d[2] || d[4], d[3]);
  if (!(s >= 1 && s <= 24 * 3600)) return null;
  return { action: "start", seconds: Math.round(s), label: labelOf(q, d[0]) };
}

function formatDuration(s) {
  s = Math.round(s);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  if (s >= 60) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${s} s`;
}

// Gestionnaire : émet "update" (liste) à chaque changement et "fire" (minuteur) à l'échéance.
class Timers extends EventEmitter {
  constructor() {
    super();
    this.list = [];
    this.seq = 0;
  }

  start(seconds, label = "Minuteur") {
    const t = { id: ++this.seq, label, seconds, endsAt: Date.now() + seconds * 1000 };
    t.handle = setTimeout(() => this.fire(t.id), seconds * 1000);
    this.list.push(t);
    this.emit("update", this.view());
    return t;
  }

  fire(id) {
    const t = this.list.find((x) => x.id === id);
    if (!t) return;
    this.list = this.list.filter((x) => x.id !== id);
    this.emit("update", this.view());
    this.emit("fire", { id: t.id, label: t.label, seconds: t.seconds });
  }

  // label vide : tous les minuteurs ; sinon ceux dont le libellé correspond.
  cancel(label) {
    const match = (t) => !label || norm(t.label).includes(norm(label)) || norm(label).includes(norm(t.label));
    const gone = this.list.filter(match);
    for (const t of gone) clearTimeout(t.handle);
    this.list = this.list.filter((t) => !gone.includes(t));
    if (gone.length) this.emit("update", this.view());
    return gone.length;
  }

  cancelId(id) {
    const t = this.list.find((x) => x.id === id);
    if (!t) return 0;
    clearTimeout(t.handle);
    this.list = this.list.filter((x) => x !== t);
    this.emit("update", this.view());
    return 1;
  }

  view() {
    return this.list.map(({ id, label, endsAt, seconds }) => ({ id, label, endsAt, seconds }));
  }

  dispose() {
    for (const t of this.list) clearTimeout(t.handle);
    this.list = [];
  }
}

module.exports = { Timers, parseTimerCommand, formatDuration };
