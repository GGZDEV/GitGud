// Évaluation d'un objet par rapport au build. Plutôt que « l'objet a-t-il exactement les affixes du
// guide ? », on pèse chaque affixe selon tout le build, on compare les valeurs à la pièce portée
// (avec les écarts que le jeu affiche lui-même), puis on applique des règles selon la rareté.
//
// Poids d'un affixe pour un emplacement :
//   prioritaire (1)   : dans la liste du build pour cet emplacement (★ affixe supérieur : 1,2)
//   utile (0,6)       : demandé ailleurs dans le build (le poison sur les gants d'un build poison)
//   proche (0,35)     : même caractéristique sous une autre forme (dégâts sur la durée ≈ multiplicateur
//                       de dégâts sur la durée, résistance au froid ≈ résistance à tous les éléments)
//   inutile (0)
const { clean, words } = require("./affixes");
const { rollQuality } = require("./item");

const WEIGHT = { prio: 1, greater: 1.2, build: 0.6, near: 0.35 };
// Valeur d'un pouvoir, sur la même échelle que les affixes
const POWER = { targetUnique: 2.5, slotAspect: 1.5, buildAspect: 0.75, unknown: 0.75, other: 0.25 };
const MARGIN = 0.25; // gain net minimal pour parler d'amélioration (pas d'égalité « mieux »)
const BIG = 1; // nette amélioration
// Mots trop généraux pour rapprocher deux caractéristiques
const GENERIC = new Set([
  "multiplicateur", "multiplier", "degats", "damage", "bonus", "augmente", "augmentee", "increased", "points", "point", "total", "tous", "toutes",
  "all", "maximum", "max", "vie", "life", "chances", "chance", "contre", "against", "sur", "plus", "x", "competences", "skills",
  "vitesse", "speed", "reduction", "taux", "rate", "attaque", "attack", "temps", "time",
]);

// Emplacements du build correspondant à l'emplacement d'un objet (les anneaux ont 2 cibles).
function targetsFor(variant, slot) {
  if (!variant || !slot) return [];
  if (slot === "ring") return variant.slots.filter((s) => /^ring/.test(s.slot));
  if (slot === "weapon") return variant.slots.filter((s) => /weapon/.test(s.slot));
  // Mobalytics numérote les charmes (« season-12-charm-6 ») : tous visent l'emplacement « charme »
  if (slot === "charm") return variant.slots.filter((s) => /charm/.test(s.slot));
  return variant.slots.filter((s) => s.slot === slot);
}

// Emplacements d'équipement (pas les charmes, sceaux, pouvoirs de saison…)
const isGearSlot = (s) => !/charm|seal|power|talisman|triad|rune|gem/i.test(`${s.slot} ${s.kind}`);

// Guide de montée de niveau : souvent un aspect par pièce et aucune priorité d'affixes. Les pièces
// sans priorité reprennent alors celles données ailleurs dans le build, plus la caractéristique
// principale de la classe ; le verdict précise qu'elles sont déduites.
function withDefaults(variant, build, mainStat) {
  if (!variant) return variant;
  const gear = variant.slots.filter(isGearSlot);
  if (gear.every((s) => s.affixes.length)) return variant;
  const pool = new Map();
  const add = (a) => a && !pool.has(a.label) && pool.set(a.label, { ...a, greater: false, masterwork: false });
  for (const s of gear) s.affixes.forEach(add);
  if (!pool.size) for (const v of build?.variants || []) for (const s of v.slots.filter(isGearSlot)) s.affixes.forEach(add);
  if (mainStat && ![...pool.values()].some((a) => a.key === mainStat.key || a.keys?.includes(mainStat.key))) add(mainStat);
  if (!pool.size) return variant;
  const general = [...pool.values()];
  return { ...variant, slots: variant.slots.map((s) => (isGearSlot(s) && !s.affixes.length ? { ...s, affixes: general, inferred: true } : s)) };
}

function wants(affixes, affix) {
  const c = clean(affix.text);
  return affixes.find((w) => {
    const sameFamily = w.keys?.length ? w.keys.includes(affix.key) : w.key && affix.key === w.key;
    if (sameFamily) return !w.must?.length || w.must.some((t) => c.includes(t));
    if (w.terms) return w.terms.every((t) => c.includes(t)) && (!w.anyOf?.length || w.anyOf.some((t) => t && c.includes(t)));
    return false;
  });
}

const contentWords = (s) => words(s).filter((w) => w.length > 2 && !GENERIC.has(w));

// Affixes voulus dans tout le build (équipement), sans doublon
function buildPool(variant) {
  const seen = new Map();
  for (const s of (variant?.slots || []).filter(isGearSlot)) for (const a of s.affixes) if (!seen.has(a.label)) seen.set(a.label, a);
  return [...seen.values()].map((a) => ({ ...a, content: contentWords(a.label) }));
}

// Poids d'un affixe pour la cible : { tag, w, family, label }
function weigh(affix, target, pool) {
  const p = wants(target.affixes, affix);
  if (p) return { tag: "prio", w: p.greater ? WEIGHT.greater : WEIGHT.prio, family: p.label, label: p.label, greater: !!p.greater, priority: target.affixes.indexOf(p) + 1 };
  const b = wants(pool, affix);
  if (b) return { tag: "build", w: WEIGHT.build, family: b.label, label: b.label };
  const cw = contentWords(affix.text);
  const near = cw.length && pool.find((a) => a.content.some((w) => cw.includes(w)));
  const family = affix.key || clean(affix.text);
  if (near) return { tag: "near", w: WEIGHT.near, family, label: near.label };
  return { tag: "none", w: 0, family, label: null };
}

// Ampleur d'un tirage : 0,6 au bas de la fourchette, 1 au maximum (0,8 sans fourchette)
const magnitude = (a) => 0.6 + 0.4 * (rollQuality(a) ?? 0.5);

// Caractéristiques d'un objet regroupées par famille : Map famille → { w, tag, value, mag, text }
function statVector(affixes, target, pool) {
  const vec = new Map();
  for (const a of affixes) {
    const wt = weigh(a, target, pool);
    const cur = vec.get(wt.family);
    if (cur) {
      cur.value += a.value ?? 0;
      cur.mag = Math.max(cur.mag, magnitude(a));
    } else vec.set(wt.family, { ...wt, value: a.value ?? 0, mag: magnitude(a), text: displayText(a.text) });
  }
  return vec;
}

// Texte d'affixe sans fourchette ni écart du jeu : « +1 794 points de vie maximum »
const displayText = (t) =>
  String(t)
    .replace(/\s*\(\s*[+-][^)]*\)\s*$/, "")
    .replace(/\s*\+?\[[^\]]*\]\s*%?/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fmt = (n) => {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toLocaleString("fr-FR");
};

// Pièce portée telle que le jeu la décrit dans la comparaison : valeur = valeur − écart, plus les
// propriétés perdues. null si l'infobulle ne contient pas de comparaison exploitable.
function equippedFromComparison(item, target, pool) {
  if (!item.hasComparison) return null;
  const withDelta = item.affixes.filter((a) => a.delta != null);
  if (!withDelta.length && !item.lost?.length && !item.lostPower) return null;
  const affixes = [];
  for (const a of withDelta) {
    const v = (a.value ?? 0) - a.delta;
    if (Math.abs(v) > 1e-6) affixes.push({ ...a, value: v, min: null, max: null });
  }
  return statVector([...affixes, ...(item.lost || [])], target, pool);
}

// Compare deux vecteurs : gain net (pondéré) et liste des écarts lisibles
function compareVectors(nv, ev) {
  const changes = [];
  for (const fam of new Set([...nv.keys(), ...ev.keys()])) {
    const n = nv.get(fam);
    const e = ev.get(fam);
    const w = (n || e).w;
    if (!w) continue;
    let score;
    let text;
    if (n && e) {
      const rel = (n.value - e.value) / Math.max(Math.abs(n.value), Math.abs(e.value), 1e-6);
      if (Math.abs(rel) < 0.02) continue;
      score = w * rel;
      text = `${fmt(n.value - e.value)} ${shortLabel(n)}`;
    } else if (n) {
      score = w * n.mag;
      text = n.text;
    } else {
      score = -w * e.mag;
      text = e.text;
    }
    changes.push({ score, text, tag: (n || e).tag });
  }
  const net = changes.reduce((s, c) => s + c.score, 0);
  return { net, changes };
}

// « +1 794 points de vie maximum » → « points de vie maximum »
const shortLabel = (s) => s.text.replace(/^[^a-zA-ZÀ-ÿ]*/, "").replace(/^(x|à|a)\s+/i, "").trim();

// Aspects visés par le build (noms affichés dans les objets qui les portent)
function aspectForms(t) {
  return t.kind === "aspect" ? t.aspectForms || (t.aspectFr ? [t.aspectFr] : []) : [];
}
const hasForm = (item, forms) => {
  const n = ` ${clean(item.name)} `;
  return forms.some((f) => f && n.includes(` ${clean(f)} `));
};
const isUnique = (item) => item.rarity === "unique" || item.rarity === "mythic";
const isNamed = (item, t) => [t.title, t.titleFr].some((x) => x && clean(item.name).includes(clean(x)));

// Valeur du pouvoir (aspect, pouvoir unique) d'un objet pour cette cible
function powerOf(item, target, variant) {
  if (!item) return 0;
  if (["unique", "charms", "charm"].includes(target.kind) && isNamed(item, target)) return POWER.targetUnique;
  if (isUnique(item)) {
    // Unique visé par un autre emplacement du build (anneaux)
    return (variant?.slots || []).some((s) => s.kind === "unique" && isNamed(item, s)) ? POWER.targetUnique : POWER.other;
  }
  if (hasForm(item, aspectForms(target))) return POWER.slotAspect;
  if ((variant?.slots || []).some((s) => hasForm(item, aspectForms(s)))) return POWER.buildAspect;
  return item.power_text || item.rarity === "legendary" ? POWER.other : 0;
}

function scoreAgainst(item, target, variant, pool) {
  const affixes = [...item.affixes];
  const checks = affixes.map((a) => {
    const wt = weigh(a, target, pool);
    return {
      text: displayText(a.text),
      tag: wt.tag,
      wanted: wt.tag === "prio",
      useful: wt.tag === "build" || wt.tag === "near",
      greaterWanted: !!wt.greater,
      label: wt.label,
      priority: wt.priority || null,
      quality: rollQuality(a),
      delta: item.hasComparison && a.delta != null ? (Math.abs(a.delta - (a.value ?? 0)) < 1e-6 ? "nouveau" : fmt(a.delta)) : null,
    };
  });
  const wantedCount = checks.filter((c) => c.wanted).length;
  const usefulCount = checks.filter((c) => c.useful).length;
  const wanted = checks.filter((c) => c.wanted);
  const avgQuality = wanted.length ? wanted.reduce((s, c) => s + (c.quality ?? 0.5), 0) / wanted.length : 0;
  const isTargetUnique = ["unique", "charms", "charm"].includes(target.kind) && isNamed(item, target);
  const missing = target.affixes.filter((w) => !checks.some((c) => c.wanted && c.label === w.label)).map((w) => (w.greater ? "★" : "") + w.label);
  const forms = aspectForms(target);
  const aspect = forms.length ? { label: `Aspect ${target.aspectFr}`, has: hasForm(item, forms) } : null;
  const value = checks.reduce((s, c, i) => s + weigh(affixes[i], target, pool).w * magnitude(affixes[i]), 0);
  return { target, checks, wantedCount, usefulCount, total: checks.length, avgQuality, isTargetUnique, missing, aspect, value };
}

// Comparaison à la pièce portée : d'abord celle que décrit le jeu dans l'infobulle, sinon la pièce
// mémorisée. null si rien n'est connu.
function compareToEquipped(item, best, variant, pool, current) {
  const target = best.target;
  const nv = statVector(item.affixes, target, pool);
  let ev = equippedFromComparison(item, target, pool);
  const fromGame = !!ev;
  if (!ev && current) ev = statVector(current.affixes, target, pool);
  if (!ev) return null;
  const { net: statNet, changes } = compareVectors(nv, ev);
  const powerNew = powerOf(item, target, variant);
  // Pouvoir de la pièce portée : celle mémorisée si on la connaît, sinon ce que dit le jeu
  // Sans pièce mémorisée : le jeu ne liste un pouvoir dans les propriétés perdues que si la pièce
  // portée en a un et celui-ci non. Sinon on suppose le même pouvoir (aucun gain annoncé à tort).
  let powerEq = current ? powerOf(current, target, variant) : item.lostPower ? POWER.unknown : powerNew;
  if (fromGame && current && !current.power_text && item.lostPower) powerEq = POWER.unknown; // mémoire périmée
  const powerChange = powerNew - powerEq;
  // Seuls les pouvoirs qui comptent pour le build sont cités (pas un pouvoir légendaire quelconque)
  if (Math.abs(powerChange) >= 0.5) {
    const label = powerChange > 0 ? powerLabel(item, target, variant) : current ? powerLabel(current, target, variant) : "pouvoir légendaire";
    changes.push({ score: powerChange, text: label, tag: "power" });
  }
  const net = statNet + powerChange;
  // Rare / légendaire sans l'aspect de l'emplacement : en y imprégnant l'aspect du build
  const canImprint = !isUnique(item) && target.kind === "aspect" && !best.aspect?.has && ["rare", "legendary"].includes(item.rarity);
  // Base presque aussi bonne en caractéristiques : sinon l'aspect seul ne justifie pas de la garder
  const potential = canImprint && statNet > -0.5 ? statNet + POWER.slotAspect - powerEq : null;
  changes.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return {
    than: current?.name || "ta pièce portée",
    net,
    potential,
    gains: changes.filter((c) => c.score > 0).map((c) => c.text),
    losses: changes.filter((c) => c.score < 0).map((c) => c.text),
  };
}

function powerLabel(item, target, variant) {
  if (isUnique(item)) return `pouvoir unique (${item.name.toLowerCase()})`;
  const t = (variant?.slots || []).find((s) => hasForm(item, aspectForms(s)));
  return t ? `Aspect ${t.aspectFr}` : "pouvoir légendaire";
}

// Équipement majoritairement ancestral : on ne cherche plus que de l'ancestral
function ancestralStage(equipped) {
  const gear = Object.entries(equipped || {}).filter(([k, it]) => /^(helm|chest-armor|gloves|pants|boots|weapon|offhand|amulet|ring-\d)$/.test(k) && it && !isUnique(it));
  const anc = gear.filter(([, it]) => it.ancestral).length;
  return anc >= 2 && anc >= gear.length / 2;
}

const listText = (arr, n = 2) => arr.slice(0, n).join(", ") + (arr.length > n ? "…" : "");

function decide(item, best, cmp, opts) {
  const t = best.target;
  if (best.isTargetUnique) return { level: "top", text: /charm/.test(t.kind) ? "Charme du build !" : "Unique du build !" };
  // Charmes : seul le nom compte (leurs affixes ne sont pas des priorités de build)
  if (/charm/.test(t.kind)) return { level: "neutral", text: "Charme hors build" };
  if (item.rarity === "magic" || item.rarity === "common") return { level: "bad", text: "Objet magique : à recycler" };
  if (!best.total) return { level: "neutral", text: "Pas d'affixe à évaluer" };

  const gainTxt = cmp && cmp.gains.length ? ` : ${listText(cmp.gains)}` : "";
  const lossTxt = cmp && cmp.losses.length ? ` (perd ${listText(cmp.losses)})` : "";
  const buildAspect = powerOf(item, t, opts.variant) >= POWER.buildAspect && !isUnique(item);
  const codex = buildAspect ? " — l'aspect ira au codex s'il est meilleur" : "";

  // Pièce portée survolée : simple bilan
  if (opts.worn) return { level: "neutral", text: `Pièce portée : ${best.wantedCount} prioritaire(s), ${best.usefulCount} utile(s) sur ${best.total}` };

  if (isUnique(item)) {
    if (cmp && cmp.net > BIG) return { level: "good", text: `Unique hors build, mais nettement mieux que ${cmp.than}${gainTxt}` };
    return { level: "bad", text: "Unique hors build : à recycler (ses affixes ne se changent pas)" };
  }
  // On ne cherche plus que de l'ancestral : le reste ne vaut que s'il bat nettement la pièce portée
  // (sauf si la pièce portée à cet emplacement n'est pas ancestrale non plus)
  if (opts.ancestralStage && !item.ancestral && opts.current?.ancestral !== false) {
    if (cmp && cmp.net > BIG) return { level: "good", text: `Amélioration (non ancestrale)${gainTxt}` };
    const worse = cmp && cmp.net <= MARGIN ? ` et moins bien que ${cmp.than}` : "";
    return { level: buildAspect ? "meh" : "bad", text: `Non ancestral${worse} : à recycler${codex}` };
  }
  if (cmp) {
    if (cmp.net > BIG) return { level: "top", text: `Nette amélioration${gainTxt}${lossTxt}` };
    if (cmp.net > MARGIN) return { level: "good", text: `Amélioration${gainTxt}${lossTxt}` };
    if (cmp.potential != null && cmp.potential > MARGIN && best.wantedCount + best.usefulCount >= 2) {
      return { level: "good", text: `Base à imprégner (${best.target.aspectFr ? `aspect ${best.target.aspectFr}` : "aspect du build"})${gainTxt}` };
    }
    return { level: buildAspect ? "meh" : "bad", text: `Moins bien que ${cmp.than} : à recycler${codex}${lossTxt}` };
  }
  // Rien à comparer : jugement sur l'objet seul
  const strong = best.wantedCount >= Math.min(3, best.target.affixes.length || 3);
  if (strong && (best.aspect?.has || !best.aspect)) return { level: "good", text: `Bon : ${best.wantedCount} affixes prioritaires sur ${best.total}` };
  if (strong) return { level: "good", text: `Bonne base : ${best.wantedCount} affixes prioritaires, imprègne l'aspect ${best.target.aspectFr || "du build"}` };
  if (buildAspect) return { level: "meh", text: `${best.wantedCount + best.usefulCount}/${best.total} affixes utiles, mais porte un aspect du build${codex}` };
  return { level: "bad", text: `${best.wantedCount + best.usefulCount}/${best.total} affixes utiles : à recycler` };
}

// item : objet lu ; variant : variante suivie ; equipped : { slot: item } déjà vus portés ;
// others : autres variantes du build et builds des autres personnages [{ name, variant, crossClass }]
// (ex. l'Endgame quand on suit le Starter, ou le Sacresprit quand on joue le Démoniste)
function evaluate(item, variant, equipped = {}, others = []) {
  const ev = evaluateOne(item, variant, equipped) || (others.length ? emptyEval(item) : null);
  if (!ev) return ev;
  // Objets utiles ailleurs : bons pour une autre variante ou un autre personnage (sans comparaison
  // avec l'équipement). Les armes d'une autre classe ne lui servent pas : ignorées.
  const useful = others
    .filter((o) => !(o.crossClass && /weapon|offhand/.test(item.slot || "")))
    // Déjà parfait pour la variante suivie : inutile de citer les autres variantes du même build
    .filter((o) => o.otherBuild || !["top", "good"].includes(ev.verdict.level))
    .map(({ name, variant: v }) => ({ name, ev: evaluateOne(item, v, {}, { noCompare: true }) }))
    .filter((o) => o.ev && ["top", "good"].includes(o.ev.verdict.level));
  ev.later = useful.map((o) => ({ variant: o.name, level: o.ev.verdict.level, text: o.ev.verdict.text, target: o.ev.target, wantedCount: o.ev.wantedCount, total: o.ev.total }));
  // Pas bon pour la variante suivie mais recherché par une autre : à garder, surtout pas à recycler.
  // Le détail des affixes devient celui de ce build-là, pour qu'il corresponde au verdict affiché.
  if (useful.length && !["top", "good", "neutral"].includes(ev.verdict.level)) {
    const first = useful[0];
    ev.verdict = { level: "later", text: `À garder pour ${first.name} : ${first.ev.verdict.text}` };
    const { checks, missing, aspect, target, wantedCount, total } = first.ev;
    Object.assign(ev, { checks, missing, aspect, target, wantedCount, total, compare: null, detailFor: first.name });
    ev.later = ev.later.slice(1);
  }
  return ev;
}

function evaluateOne(item, variant, equipped = {}, { noCompare = false } = {}) {
  const targets = targetsFor(variant, item.slot);
  if (!targets.length) return null;
  const pool = buildPool(variant);
  // Anneaux / armes : la cible dont l'unique ou l'aspect correspond, puis la plus utile
  const scores = targets
    .map((t) => scoreAgainst(item, t, variant, pool))
    .sort((a, b) => b.isTargetUnique - a.isTargetUnique || (b.aspect?.has ? 1 : 0) - (a.aspect?.has ? 1 : 0) || b.value - a.value);
  const best = scores[0];
  const t = best.target;
  // Pièce portée : même emplacement (les armes du build sont numérotées, « weapon-1 » ; l'équipement
  // mémorisé n'a qu'une arme)
  const current = equipped[t.slot] || (/weapon/.test(t.slot) ? equipped.weapon : null) || (item.slot === "ring" ? equipped["ring-1"] || equipped["ring-2"] : null);
  const worn = !item.hasComparison && current && current.name === item.name;
  const cmp = noCompare || worn ? null : compareToEquipped(item, best, variant, pool, current || null);
  const verdict = decide(item, best, cmp, { variant, worn, current, ancestralStage: !noCompare && ancestralStage(equipped) });
  if (t.inferred && !best.isTargetUnique && best.total && !worn) verdict.text += " (priorités déduites du build)";
  const { target, value, ...score } = best;
  return {
    ...score,
    slot: target.slot,
    slotName: target.slotName,
    target: target.title + (target.titleFr ? ` (${target.titleFr})` : ""),
    verdict,
    compare: cmp && { than: cmp.than, net: Math.round(cmp.net * 100) / 100, gains: cmp.gains, losses: cmp.losses },
    // Pour départager plusieurs objets du sac au même emplacement
    rank: best.isTargetUnique ? 99 : cmp ? Math.max(cmp.net, cmp.potential ?? -Infinity) : value,
  };
}

// Scan du sac : plusieurs objets à garder pour le même emplacement → seul le meilleur (les deux
// meilleurs pour les anneaux) reste à garder ; les autres sont à recycler. Les uniques du build et
// les objets gardés pour un autre build ne sont pas concernés.
function keepBestPerSlot(cells) {
  const groups = new Map();
  for (const c of cells) {
    const ev = c.eval;
    if (!ev || !["top", "good"].includes(ev.verdict.level) || ev.isTargetUnique) continue;
    const key = /^ring/.test(ev.slot) ? "ring" : ev.slot;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const [key, list] of groups) {
    list.sort((a, b) => (b.eval.rank ?? 0) - (a.eval.rank ?? 0));
    const keep = key === "ring" ? 2 : 1;
    const best = list[0];
    for (const c of list.slice(keep)) {
      c.eval.verdict = { level: "bad", text: `Moins bon que ${best.item.name} (sac, case ${best.row + 1}-${best.col + 1}) : à recycler` };
    }
  }
  return cells;
}

// Emplacement absent du build suivi (ex. un charme) mais peut-être utile à un autre
function emptyEval(item) {
  return { checks: item.affixes.map((a) => ({ text: displayText(a.text), tag: "none", wanted: false, quality: rollQuality(a) })), wantedCount: 0, usefulCount: 0, total: item.affixes.length, avgQuality: 0, isTargetUnique: false, missing: [], aspect: null, slot: item.slot, slotName: item.slot, target: "—", verdict: { level: "neutral", text: "Emplacement absent du build suivi" }, compare: null };
}

module.exports = { evaluate, keepBestPerSlot, targetsFor, withDefaults, isGearSlot };
