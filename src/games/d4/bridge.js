// Pont avec le lecteur d'écran de Diablo IV : regroupe les lignes reçues en infobulles.
// Le jeu envoie une ligne par élément ; une infobulle est complète quand le flux s'arrête
// un court instant (ou à la ligne d'aide de la souris qui la termine).
const { Worker } = require("worker_threads");
const path = require("path");
const { EventEmitter } = require("events");

const IDLE_MS = 120;
const END = /^(bouton (gauche|droit) de la souris|left mouse button|right mouse button|scroll down|molette)/i;

// Début de l'infobulle d'objet : dernier nom en majuscules (comme D4LF), suivi d'une ligne de type.
function itemStart(lines) {
  for (let i = lines.length - 2; i >= 0; i--) {
    const letters = lines[i].replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
    if (letters.length >= 3 && lines[i] === lines[i].toUpperCase() && !/AFFIX|SÉLECTIONNER|SELECT ALL/.test(lines[i])) return i;
  }
  return -1;
}

class D4Bridge extends EventEmitter {
  constructor() {
    super();
    this.worker = null;
    this.buffer = [];
    this.timer = null;
    this.status = "off"; // off | listening | connected | busy | error
  }

  start() {
    if (this.worker) return;
    this.worker = new Worker(path.join(__dirname, "tts-bridge-worker.js"));
    this.worker.on("message", (m) => {
      if (m.type === "line") return this.onLine(m.text);
      if (m.type === "listening") this.setStatus(this.status === "connected" ? "connected" : "listening");
      if (m.type === "connected") this.setStatus("connected");
      if (m.type === "disconnected") this.setStatus("listening");
      if (m.type === "error") this.setStatus(m.error === "busy" ? "busy" : "error", m.error);
    });
    this.worker.on("error", (err) => this.setStatus("error", err.message));
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.setStatus("off");
  }

  setStatus(status, detail) {
    this.status = status;
    this.emit("status", status, detail);
  }

  onLine(text) {
    const line = text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/\[(OBJET FAVORI|FAVORITED ITEM|MARQUÉ COMME CAMELOTE|MARKED AS JUNK)\]\.?\s*/gi, "").trim();
    if (!line) return;
    this.buffer.push(line);
    clearTimeout(this.timer);
    if (END.test(line)) this.flush();
    else this.timer = setTimeout(() => this.flush(), IDLE_MS);
  }

  flush() {
    clearTimeout(this.timer);
    const lines = this.buffer;
    this.buffer = [];
    if (!lines.length) return;
    const start = itemStart(lines);
    this.emit("tooltip", { lines: start >= 0 ? lines.slice(start) : lines, isItem: start >= 0, at: Date.now() });
  }
}

module.exports = { D4Bridge, itemStart };
