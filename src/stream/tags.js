// Balises que l'IA peut glisser dans sa réponse pour piloter GitGud, retirées du texte affiché
// et lu à voix haute, même en plein flux :
//   <memo type="objectif">…</memo>    retenir un fait sur le joueur (mémoire entre les sessions)
//   <forget>…</forget>                oublier un fait
//   <mark x="812" y="440" label="Entrée" shape="circle"/>   repère dessiné sur le jeu
//   <timer seconds="300" label="Boss"/>                      minuteur
const PAIRED = ["memo", "forget"];
const SINGLE = ["mark", "timer"];
const NAMES = [...PAIRED, ...SINGLE];
const MAX_HOLD = 600; // au-delà, ce n'était pas une balise : on rend le texte tel quel

function attrs(s) {
  const out = {};
  for (const [, k, v] of s.matchAll(/([a-z]+)\s*=\s*"([^"]*)"/gi)) out[k.toLowerCase()] = v;
  return out;
}

// Le texte à partir de « < » peut-il encore devenir une de nos balises ?
function couldBeTag(rest) {
  const m = rest.match(/^<\/?([a-z]*)/i);
  if (!m) return false;
  const name = m[1].toLowerCase();
  if (m[0].length === rest.length) return NAMES.some((n) => n.startsWith(name)); // nom encore incomplet
  return NAMES.includes(name);
}

class TagFilter {
  constructor() {
    this.buf = "";
    this.tags = [];
  }

  // Renvoie le texte sûr à afficher ; garde en réserve un début de balise possible.
  push(delta) {
    this.buf += delta;
    let out = "";
    for (;;) {
      const lt = this.buf.indexOf("<");
      if (lt < 0) {
        out += this.buf;
        this.buf = "";
        return out;
      }
      out += this.buf.slice(0, lt);
      this.buf = this.buf.slice(lt);
      const parsed = this.parse();
      if (parsed === "wait") {
        if (this.buf.length <= MAX_HOLD) return out;
        out += this.buf[0]; // balise jamais fermée : du texte ordinaire
        this.buf = this.buf.slice(1);
      } else if (parsed === "text") {
        out += "<";
        this.buf = this.buf.slice(1);
      }
    }
  }

  // Tente de lire une balise en tête du tampon : "tag" (consommée), "wait" ou "text".
  parse() {
    const b = this.buf;
    if (!couldBeTag(b)) return "text";
    const open = b.match(/^<([a-z]+)([^<>]*?)(\/?)>/i);
    if (!open) return /^<[a-z]*[^<>]*$/i.test(b) ? "wait" : "text";
    const name = open[1].toLowerCase();
    if (!NAMES.includes(name)) return "text";
    if (SINGLE.includes(name)) {
      this.tags.push({ name, ...attrs(open[2]) });
      this.buf = b.slice(open[0].length);
      return "tag";
    }
    const close = b.toLowerCase().indexOf(`</${name}>`, open[0].length);
    if (close < 0) return "wait";
    this.tags.push({ name, ...attrs(open[2]), text: b.slice(open[0].length, close).trim() });
    this.buf = b.slice(close + name.length + 3);
    return "tag";
  }

  // Fin du flux : le reste est du texte (balise incomplète comprise).
  flush() {
    const rest = this.buf;
    this.buf = "";
    return rest;
  }
}

// Variante d'un coup, pour une réponse déjà complète.
function stripTags(text) {
  const f = new TagFilter();
  const clean = f.push(text) + f.flush();
  return { text: clean.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), tags: f.tags };
}

module.exports = { TagFilter, stripTags };
