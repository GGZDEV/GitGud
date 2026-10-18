// Évaluation d'un objet par rapport au build : chaque affixe voulu / non voulu, qualité des
// tirages, objet unique ou aspect visé, comparaison avec l'objet équipé, verdict.
const { clean } = require("./affixes");
const { rollQuality } = require("./item");

// Emplacements du build correspondant à l'emplacement d'un objet (les anneaux ont 2 cibles).
function targetsFor(variant, slot) {
  if (!variant || !slot) return [];
  if (slot === "ring") return variant.slots.filter((s) => /^ring/.test(s.slot));
  if (slot === "weapon") return variant.slots.filter((s) => /weapon/.test(s.slot));
  return variant.slots.filter((s) => s.slot === slot);
}

function wants(target, affix) {
  const c = clean(affix.text);
  return target.affixes.find((w) => {
    const sameFamily = w.keys?.length ? w.keys.includes(affix.key) : w.key && affix.key === w.key;
    if (sameFamily) return !w.must?.length || w.must.some((t) => c.includes(t));
    if (w.terms) return w.terms.every((t) => c.includes(t)) && (!w.anyOf?.length || w.anyOf.some((t) => t && c.includes(t)));
    return false;
  });
}

function scoreAgainst(item, target) {
  const checks = item.affixes.map((a) => {
    const w = wants(target, a);
    // priority : rang de l'affixe dans la liste du build (1 = le plus important)
    return { text: a.text, wanted: !!w, greaterWanted: !!w?.greater, label: w?.label || null, priority: w ? target.affixes.indexOf(w) + 1 : null, quality: rollQuality(a) };
  });
  const wanted = checks.filter((c) => c.wanted);
  const avgQuality = wanted.length ? wanted.reduce((s, c) => s + (c.quality ?? 0.5), 0) / wanted.length : 0;
  const nameC = clean(item.name);
  const isTargetUnique = target.kind === "unique" && [target.title, target.titleFr].some((t) => t && nameC.includes(clean(t)));
  const missing = target.affixes.filter((w) => !checks.some((c) => c.wanted && c.label === w.label)).map((w) => (w.greater ? "★" : "") + w.label);
  // Aspect visé : son nom (« de pestilence ») figure dans le nom des objets légendaires qui le portent
  const forms = target.aspectForms || (target.aspectFr ? [target.aspectFr] : []);
  const aspect = target.kind === "aspect" && forms.length
    ? { label: `Aspect ${target.aspectFr}`, has: forms.some((f) => ` ${nameC} `.includes(` ${clean(f)} `)) }
    : null;
  return { target, checks, wantedCount: wanted.length, total: checks.length, avgQuality, isTargetUnique, missing, aspect };
}

// Verdict lisible à partir d'un score
function verdictOf(s, item) {
  if (s.isTargetUnique) return { level: "top", text: "Unique du build !" };
  if (!s.total) return { level: "neutral", text: "Pas d'affixe à évaluer" };
  const misses = s.total - s.wantedCount;
  if (misses === 0) return { level: "top", text: `Parfait : ${s.wantedCount}/${s.total} affixes du build` };
  if (misses === 1 && s.wantedCount >= 2) return { level: "good", text: `Bon : ${s.wantedCount}/${s.total}, 1 affixe à retoucher chez l'enchanteur` };
  if (s.aspect?.has) return { level: "meh", text: `${s.wantedCount}/${s.total} affixes, mais porte l'aspect du build : à extraire` };
  return { level: "bad", text: `${s.wantedCount}/${s.total} affixes du build : à recycler` };
}

// item : objet lu ; variant : variante du build ; equipped : { slot: item } déjà vus portés
function evaluate(item, variant, equipped = {}) {
  const targets = targetsFor(variant, item.slot);
  if (!targets.length) return null;
  // Anneaux / armes : la cible dont l'aspect correspond, puis celle qui a le plus d'affixes voulus
  const scores = targets
    .map((t) => scoreAgainst(item, t))
    .sort((a, b) => (b.aspect?.has ? 1 : 0) - (a.aspect?.has ? 1 : 0) || b.wantedCount - a.wantedCount || b.avgQuality - a.avgQuality);
  const best = scores[0];
  const verdict = verdictOf(best, item);

  // Comparaison avec l'objet porté au même emplacement (s'il a déjà été vu)
  const current = equipped[best.target.slot] || (item.slot === "ring" ? equipped["ring-1"] || equipped["ring-2"] : null);
  let upgrade = null;
  if (current && current !== item && current.name !== item.name) {
    const cur = scoreAgainst(current, best.target);
    const delta = best.wantedCount - cur.wantedCount || Math.sign(best.avgQuality - cur.avgQuality);
    upgrade = { than: current.name, better: delta > 0, worse: delta < 0, currentWanted: cur.wantedCount, currentTotal: cur.total };
    // Mieux que ce que tu portes : à garder, même si l'objet n'est pas parfait
    if (upgrade.better && verdict.level !== "top") {
      verdict.level = "good";
      verdict.text = `Amélioration : ${best.wantedCount}/${best.total} affixes du build (tu portes ${cur.wantedCount}/${cur.total})`;
    }
  }
  const { target, ...score } = best;
  return { ...score, slot: target.slot, slotName: target.slotName, target: target.title + (target.titleFr ? ` (${target.titleFr})` : ""), verdict, upgrade };
}

module.exports = { evaluate, targetsFor };
