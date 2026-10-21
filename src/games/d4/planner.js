// Compétences et Parangon : plan tiré du build (Mobalytics), lecture des infobulles de
// l'arbre de compétences / du Parangon / de la fiche de personnage, et verdict au survol.
const { clean } = require("./affixes");

const slugify = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const same = (a, b) => clean(a) === clean(b);

// ---------- Plan du build ----------

function classIndex(dict, className) {
  return Object.entries(dict.classes || {}).find(([, c]) => same(c.en, className) || same(c.fr, className))?.[0] ?? null;
}

// Modificateur Mobalytics (« ravager-flurry-of-claws ») → modificateur du jeu (même nom, sinon le
// plus de mots en commun : « ferocity-minimum » ↔ « Ferocity Maximum »).
function findMod(mods, rest) {
  const exact = mods.findIndex((m) => slugify(m.en) === rest);
  if (exact >= 0) return exact;
  const words = rest.split("-");
  let best = -1;
  let score = 0;
  mods.forEach((m, i) => {
    const s = slugify(m.en).split("-").filter((w) => words.includes(w)).length;
    if (s > score) [best, score] = [i, s];
  });
  return best;
}

// Variante Mobalytics → { skills: [{ key, fr, en, rank, onBar, mods: [{ fr, en, big }] }], paragon }
function planFromMobalytics(v, dict, className) {
  if (!dict.skillInfo || !dict.paragonBoards) return null;
  const cls = classIndex(dict, className);
  const classSkills = Object.entries(dict.skillInfo).filter(([, s]) => cls == null || String(s.cls) === String(cls));
  const bySlug = new Map(classSkills.map(([k]) => [slugify(dict.skills[k]?.en), k]));
  const skills = new Map();
  const skillFor = (slug) => {
    const key = bySlug.get(slug);
    if (!key) return null;
    if (!skills.has(key)) skills.set(key, { key, fr: dict.skills[key].fr, en: dict.skills[key].en, rank: 0, onBar: false, mods: [] });
    return skills.get(key);
  };

  for (const step of v.skillTree?.skills || []) {
    const slug = step.skill?.slug || "";
    const type = step.skill?.type?.id;
    const sign = step.actionType === "DEACTIVATE" ? -1 : 1;
    if (type === "basic") {
      const s = skillFor(slug);
      if (s) s.rank = Math.max(0, s.rank + sign);
      continue;
    }
    // Modificateur : préfixe = compétence
    const owner = [...bySlug.keys()].filter((k) => slug.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];
    const s = owner && skillFor(owner);
    if (!s) continue;
    const mods = dict.skillInfo[s.key].mods;
    const i = findMod(mods, slug.slice(owner.length + 1));
    if (i < 0) continue;
    const m = { fr: mods[i].fr, en: mods[i].en, big: type === "enhancement" };
    if (sign > 0 && !s.mods.some((x) => x.en === m.en)) s.mods.push(m);
    if (sign < 0) s.mods = s.mods.filter((x) => x.en !== m.en);
  }
  for (const a of v.assignedSkills?.skills || []) {
    const s = skillFor(a.skill?.slug || "");
    if (s) s.onBar = true;
  }

  return { skills: [...skills.values()].filter((s) => s.rank > 0 || s.onBar), paragon: paragonPlan(v.paragon, dict, cls) };
}

function paragonPlan(p, dict, cls) {
  const out = { boards: [], rares: [], legendaries: [], glyphs: [], magic: {} };
  if (!p) return out;
  const classBoards = cls != null ? dict.classes[cls]?.boards || [] : Object.keys(dict.paragonBoards);
  // « spiritborn-starter-board » ↔ plateau « Start » ; sinon nom anglais du plateau
  const boardOf = (slug) =>
    classBoards.find((k) => {
      const n = slugify(dict.paragonBoards[k]?.en);
      return n === "start" ? /starter-board$/.test(slug) : slug.endsWith("-" + n);
    });
  // Le plateau de départ s'appelle « Commencer » dans les données françaises
  const boardName = (b) => (b.en === "Start" ? "Plateau de départ" : b.fr || b.en);
  const seen = new Set();
  for (const b of p.boards || []) {
    const key = boardOf(b.board?.slug || "");
    if (key) out.boards.push({ key, fr: boardName(dict.paragonBoards[key]), en: dict.paragonBoards[key].en });
    if (b.glyph?.slug) {
      const g = Object.values(dict.paragonGlyphs || {}).find((x) => b.glyph.slug.endsWith("-" + slugify(x.en)));
      if (g) out.glyphs.push({ fr: g.fr, en: g.en, level: b.glyphLevel || null, board: key ? boardName(dict.paragonBoards[key]) : null });
    }
  }
  for (const n of p.nodes || []) {
    // Coordonnées Mobalytics : colonne et ligne comptées à partir de 1, plateau non tourné
    const m = n.slug?.match(/^(.*)-x(\d+)-y(\d+)$/);
    const key = m && boardOf(m[1]);
    const board = key && dict.paragonBoards[key];
    const node = board?.nodes[(Number(m[3]) - 1) * board.width + Number(m[2]) - 1];
    if (!node || seen.has(`${key}:${node}:${m[2]}:${m[3]}`)) continue;
    seen.add(`${key}:${node}:${m[2]}:${m[3]}`);
    const name = dict.paragonNodes?.[node];
    if (/_Legendary_/.test(node) && name) out.legendaries.push({ fr: name.fr, en: name.en, board: boardName(board) });
    else if (/_Rare_/.test(node) && name) out.rares.push({ fr: name.fr, en: name.en, board: boardName(board) });
    else if (/^Generic_Magic_/.test(node)) {
      const t = node.replace(/^Generic_Magic_/, "");
      out.magic[t] = (out.magic[t] || 0) + 1;
    }
  }
  return out;
}

// ---------- Lecture des infobulles ----------

const RE = {
  rank: /^(RANG|RANK)\s+(\d+)\s*\/\s*(\d+)$/i,
  modOnly: /^(Vous ne pouvez choisir qu.un seul modificateur|You can only choose one modifier)/i,
  notLearned: /^(Pas encore apprise?|Not yet learned)/i,
  node: /^(Nœud|Noeud)\s+(normal|magique|rare|légendaire)$|^(Normal|Magic|Rare|Legendary)\s+Node$/i,
  socket: /^(Châsse\s+de\s+glyphe|Glyph\s+Socket)$/i,
  glyph: /^(GLYPHE\s+ENCHÂSSÉ|SOCKETED\s+GLYPH)\s*:?$/i,
  refund: /^(Remboursement|Refund)$/i,
  locked: /^(Pas encore déverrouillé|Not yet unlocked)/i,
  weapon: /^(Dégâts\s+des\s+armes|Weapon\s+Damage)$/i,
  toughness: /^(Robustesse|Toughness)$/i,
  // Nom de personnage tel que l'affiche la fiche : une seule « forme », en majuscules, sans espace
  charName: /^[A-ZÀ-ÖØ-Þ]{2,16}$/,
};
const RARITY = { normal: "normal", magique: "magic", magic: "magic", rare: "rare", légendaire: "legendary", legendary: "legendary" };
const isHotkey = (l) => /^\d$|^[A-Z]$/.test(l);

// Dernier élément reconnaissable de la liste de lignes (le lecteur d'écran enchaîne parfois
// plusieurs survols dans un même paquet : seul le dernier compte).
function parseTooltip(input) {
  const lines = input.map((l) => l.replace(/[  ]/g, " ")); // espaces insécables du jeu
  const found = [];
  lines.forEach((l, i) => {
    if (RE.rank.test(l)) found.push(["skill", i]);
    else if (RE.modOnly.test(l)) found.push(["mod", i]);
    else if (RE.node.test(l)) found.push(["node", i]);
    else if (RE.socket.test(l)) found.push(["socket", i]);
    else if (RE.weapon.test(l) && i >= 2) found.push(["character", i]);
  });
  if (!found.length) return null;
  const [kind, i] = found[found.length - 1];
  const after = (from) => {
    const out = [];
    for (let j = from; j < lines.length; j++) {
      if (j > from && (RE.node.test(lines[j]) || RE.socket.test(lines[j]) || RE.rank.test(lines[j]))) break;
      out.push(lines[j]);
    }
    return out;
  };

  if (kind === "skill") {
    let n = i - 1;
    while (n >= 0 && isHotkey(lines[n])) n--;
    const [, , cur, max] = lines[i].match(RE.rank);
    return { kind, name: lines[n] || "", rank: Number(cur), max: Number(max), learned: Number(cur) > 0 && !after(i).some((l) => RE.notLearned.test(l)) };
  }
  if (kind === "mod") {
    return { kind, name: lines[i - 2] || "", desc: lines[i - 1] || "", learned: !RE.notLearned.test(lines[i + 1] || "") };
  }
  if (kind === "node") {
    const r = lines[i].match(RE.node);
    const rarity = RARITY[(r[2] || r[3] || "").toLowerCase()];
    const rest = after(i + 1);
    const named = rarity === "rare" || rarity === "legendary";
    return {
      kind,
      rarity,
      name: named ? rest[0] || "" : null,
      stats: (named ? rest.slice(1) : rest).filter((l) => /^[+-]?\s*\d|%/.test(l.trim())).map((l) => l.trim()).slice(0, 2),
      allocated: rest.some((l) => RE.refund.test(l)),
      locked: rest.some((l) => RE.locked.test(l)),
    };
  }
  if (kind === "socket") {
    const rest = after(i + 1);
    const g = rest.findIndex((l) => RE.glyph.test(l));
    return { kind, glyph: g >= 0 ? rest[g + 1] || null : null };
  }
  // Fiche de personnage : NOM, titre, « Dégâts des armes », valeur, « Robustesse »…
  const name = lines[i - 2];
  if (!RE.charName.test(name || "") || !lines.slice(i + 1, i + 5).some((l) => RE.toughness.test(l))) return null;
  return { kind: "character", name: name.charAt(0) + name.slice(1).toLowerCase(), title: lines[i - 1] };
}

// ---------- Verdict ----------

// Classe d'une compétence d'après son nom français (ou anglais)
function classOfSkill(name, dict) {
  for (const [k, info] of Object.entries(dict.skillInfo || {})) {
    if (same(dict.skills[k]?.fr, name) || same(dict.skills[k]?.en, name)) return dict.classes?.[info.cls] || null;
  }
  return null;
}

// Retourne { level: top|good|meh|bad|neutral, text, sub } ou null (rien à dire)
function judge(t, plan, dict) {
  if (!plan) return null;
  if (t.kind === "skill") {
    const s = plan.skills.find((x) => same(x.fr, t.name) || same(x.en, t.name));
    // Rang d'un aspect du Codex de puissance (même ligne « RANG x/y ») : rien à dire
    if (!s && !classOfSkill(t.name, dict)) return null;
    if (!s) return { level: "bad", text: `✗ ${t.name} : pas dans ton build`, sub: t.learned ? "Tu peux rembourser ces points" : null };
    const target = s.rank;
    const base = Math.min(t.rank, t.max); // le rang affiché inclut le bonus des objets
    const mods = s.mods.length ? `Modificateurs : ${s.mods.map((m) => m.fr).join(", ")}` : null;
    if (!t.learned) return { level: "top", text: `✓ ${s.fr} : à prendre`, sub: [`Rang visé ${target}`, mods].filter(Boolean).join(" · ") };
    return {
      level: "good",
      text: `✓ ${s.fr} · rang visé ${target}`,
      sub: [base >= target ? "Rang atteint (objets compris)" : `${target - base} point(s) de plus`, mods].filter(Boolean).join(" · "),
    };
  }
  if (t.kind === "mod") {
    // Compétence concernée : celle dont le nom apparaît dans la description
    const owner = plan.skills.find((s) => clean(t.desc).includes(clean(s.fr)));
    if (!owner) return { level: "neutral", text: `· ${t.name}`, sub: "Modificateur d'une compétence hors build" };
    const wanted = owner.mods.find((m) => same(m.fr, t.name) || same(m.en, t.name));
    if (wanted) return { level: t.learned ? "good" : "top", text: `✓ ${t.name} : ${t.learned ? "pris" : "à prendre"}`, sub: `Modificateur de ${owner.fr}` };
    const alt = owner.mods.filter((m) => m.big).map((m) => m.fr);
    return { level: "bad", text: `✗ ${t.name} : pas celui du build`, sub: alt.length ? `Pour ${owner.fr}, prends : ${alt.join(", ")}` : `Modificateurs de ${owner.fr} : ${owner.mods.map((m) => m.fr).join(", ") || "aucun"}` };
  }
  if (t.kind === "node") {
    const p = plan.paragon;
    if (t.rarity === "rare" || t.rarity === "legendary") {
      const list = t.rarity === "rare" ? p.rares : p.legendaries;
      const hit = list.find((n) => same(n.fr, t.name) || same(n.en, t.name));
      if (hit) return { level: t.allocated ? "good" : "top", text: `✓ ${t.name} : ${t.allocated ? "pris" : "à prendre"}`, sub: `Nœud ${t.rarity === "rare" ? "rare" : "légendaire"} du build${hit.board ? ` (${hit.board})` : ""}` };
      return { level: "bad", text: `✗ ${t.name} : pas dans le build`, sub: t.rarity === "rare" ? `Rares visés : ${[...new Set(p.rares.map((n) => n.fr))].join(", ")}` : null };
    }
    // Nœuds normaux / magiques : pas de nom, impossible de savoir lequel exactement
    return { level: "neutral", text: `· Nœud ${t.rarity === "magic" ? "magique" : "normal"} ${t.stats.join(" ")}`, sub: "Prends-le s'il mène à un rare ou une châsse du build" };
  }
  if (t.kind === "socket") {
    const names = p => p.glyphs.map((g) => g.fr);
    if (!t.glyph) return { level: "neutral", text: "· Châsse de glyphe vide", sub: `Glyphes du build : ${names(plan.paragon).join(", ")}` };
    const hit = plan.paragon.glyphs.find((g) => same(g.fr, t.glyph) || same(g.en, t.glyph));
    if (hit) return { level: "good", text: `✓ Glyphe ${t.glyph}`, sub: hit.level ? `Niveau visé ${hit.level}` : null };
    return { level: "bad", text: `✗ Glyphe ${t.glyph} : pas dans le build`, sub: `Glyphes du build : ${names(plan.paragon).join(", ")}` };
  }
  return null;
}

module.exports = { planFromMobalytics, parseTooltip, judge, classOfSkill, slugify };
