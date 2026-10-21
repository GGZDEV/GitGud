// Lecture en flux : découpe la réponse en phrases au fur et à mesure qu'elle arrive, pour que
// la voix commence dès la première phrase au lieu d'attendre la fin de la réponse.

// Texte à prononcer : sans liens, sans bloc « Sources », sans mise en forme markdown.
function speechText(text) {
  return text
    .replace(/\n*\s*(sources?|références?)\s*:[\s\S]*$/i, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\(?https?:\/\/\S+\)?/g, "")
    .replace(/[*_#`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FIRST_MIN = 12; // première phrase : partir vite, même courte
const NEXT_MIN = 60; // ensuite : regrouper les phrases courtes, la voix est plus naturelle
const SOURCES = /(^|\n)\s*(sources?|références?)\s*:/i;

class SentenceSplitter {
  constructor() {
    this.buf = "";
    this.count = 0;
    this.muted = false; // le bloc « Sources : » et la suite ne sont pas lus
  }

  // Renvoie les morceaux prêts à être lus.
  push(delta) {
    if (this.muted) return [];
    this.buf += delta;
    const src = this.buf.search(SOURCES);
    if (src >= 0) {
      this.buf = this.buf.slice(0, src);
      this.muted = true;
      const rest = this.take(this.buf.length);
      return rest ? [rest] : [];
    }
    const out = [];
    for (;;) {
      const end = this.boundary();
      if (end < 0) break;
      const piece = this.take(end);
      if (piece) out.push(piece);
    }
    return out;
  }

  // Fin de phrase après laquelle couper (ponctuation suivie d'un espace, ou retour à la ligne),
  // une fois atteinte la longueur minimale du morceau.
  boundary() {
    const min = this.count ? NEXT_MIN : FIRST_MIN;
    const re = /[.!?…;:]+["»)]?\s+|\n+/g;
    let m;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      // « 1. », « M. » ou « etc. » au milieu d'une phrase : pas une vraie fin
      if (/\b(\d|[A-Z]|etc|ex|cf|vs)\.\s+$/.test(this.buf.slice(Math.max(0, end - 6), end)) && m[0][0] === ".") continue;
      if (speechText(this.buf.slice(0, end)).length >= min) return end;
    }
    return -1;
  }

  take(end) {
    const piece = speechText(this.buf.slice(0, end));
    this.buf = this.buf.slice(end);
    if (piece) this.count++;
    return piece;
  }

  flush() {
    if (this.muted) return [];
    const rest = speechText(this.buf);
    this.buf = "";
    return rest ? [rest] : [];
  }
}

module.exports = { SentenceSplitter, speechText };
