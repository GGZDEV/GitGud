// Import d'un build Diablo IV depuis Mobalytics (guides et builds de profil), converti en un
// format commun : emplacements → objet ou aspect visé, affixes voulus (★ = supérieur), trempes,
// gemmes ; priorités d'équipement ; compétences ; plateaux de Parangon et glyphes.
const { clean } = require("./affixes");
const { planFromMobalytics } = require("./planner");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const SLOT_NAMES = {
  helm: "Casque", "chest-armor": "Torse", gloves: "Gants", pants: "Jambières", boots: "Bottes",
  weapon: "Arme", "bludgeoning-weapon": "Arme contondante", "slashing-weapon": "Arme tranchante",
  "dual-wield-weapon-1": "Arme principale", "dual-wield-weapon-2": "Arme secondaire", "ranged-weapon": "Arme à distance",
  offhand: "Main gauche", amulet: "Amulette", "ring-1": "Anneau 1", "ring-2": "Anneau 2",
};

const humanize = (slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function findKey(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

// Mots obligatoires pour les affixes que le dictionnaire ne couvre pas bien :
// rangs d'une compétence précise, régénération d'une ressource de classe…
function requiredTerms(slug, dict) {
  const m = slug.match(/^ranks-to-(.+)$/);
  if (m && m[1] !== "all-skills") {
    const en = humanize(m[1]);
    const skill = Object.values(dict.skills).find((s) => clean(s.en).replace(/^ph /, "") === clean(en) && !/\[?ph\]?/i.test(s.fr));
    return { terms: ["rang"], anyOf: [clean(skill?.fr || ""), clean(en)].filter(Boolean), label: `Rangs de ${skill?.fr || en}` };
  }
  const res = Object.values(dict.resources).find((r) => slug.startsWith(clean(r.en) + "-"));
  if (res && /regeneration/.test(slug)) {
    return { terms: ["regeneration"], anyOf: [clean(res.fr), clean(res.en)], label: `Régénération de ${res.fr}` };
  }
  return null;
}

function convertStats(stats, matcher, dict) {
  return (stats || []).filter(Boolean).map((s) => {
    const special = requiredTerms(s.id, dict);
    const m = special ? { key: null } : matcher.matchSlug(s.id);
    return {
      slug: s.id,
      key: m.key,
      keys: m.keys || [],
      must: m.must || [],
      greater: !!s.isGreater,
      masterwork: !!s.isMasterwork,
      label: special?.label || (m.key ? matcher.label(m.key) : humanize(s.id)),
      ...(special ? { terms: special.terms, anyOf: special.anyOf } : {}),
    };
  });
}

// « Aspect of Pestilence » / « Vulpine's Aspect » → aspect du dictionnaire (suffixe FR « de pestilence »)
function findAspect(title, dict) {
  const norm = (x) =>
    clean(x).replace(/\baspect\b/g, " ").replace(/\bs\b/g, " ").replace(/\s+/g, " ").trim().replace(/^of (the )?/, "").trim();
  const t = norm(title);
  if (!t) return null;
  return Object.values(dict.aspects || {}).find((a) => norm(a.en) === t || (a.enPrefix && norm(a.enPrefix) === t)) || null;
}

function convertSlot(slot, matcher, dict) {
  const e = slot.gameEntity || {};
  const mods = e.modifiers || {};
  const unique = e.type === "uniqueItems" ? Object.values(dict.uniques).find((u) => clean(u.en) === clean(e.title)) : null;
  const aspect = e.type === "aspects" ? findAspect(e.title, dict) : null;
  return {
    slot: slot.gameSlotSlug,
    slotName: SLOT_NAMES[slot.gameSlotSlug] || humanize(slot.gameSlotSlug),
    kind: e.type === "uniqueItems" ? "unique" : e.type === "aspects" ? "aspect" : e.type || "other",
    title: e.title || "",
    titleFr: unique?.fr || (aspect ? `Aspect ${aspect.fr}` : null),
    aspectFr: aspect?.fr || null,
    aspectForms: aspect?.frForms || null,
    affixes: convertStats(mods.gearStats, matcher, dict),
    tempering: convertStats(mods.temperingStats, matcher, dict),
    gems: (mods.socketStats || []).filter(Boolean).map((g) => g.slug),
  };
}

// Dans l'app, la pile réseau de Chromium (Electron) passe là où le fetch de Node est
// refusé par la protection anti-robots de Mobalytics.
function httpGet(url, headers) {
  try {
    const { net } = require("electron");
    if (net?.fetch) return net.fetch(url, { headers });
  } catch {}
  return fetch(url, { headers });
}

async function importMobalytics(url, matcher, dict) {
  const res = await httpGet(url, { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml" });
  if (!res.ok) throw new Error(`Mobalytics : page introuvable (${res.status})`);
  const html = await res.text();
  const marker = "window.__PRELOADED_STATE__=";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Mobalytics a changé le format de ses pages : import impossible pour l'instant.");
  let raw = html.slice(start + marker.length, html.indexOf("</script>", start)).trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1);
  const state = JSON.parse(raw);

  const doc = findKey(state, "userGeneratedDocumentBySlugifiedName") || findKey(state, "userGeneratedDocumentBySlug");
  const data = doc?.data?.data;
  if (!data?.buildVariants?.values?.length) throw new Error("Aucun build trouvé sur cette page (build privé ou archivé ?).");
  const titles = Object.fromEntries((findKey(state, "childrenVariants") || []).map((c) => [c.id, c.title]));
  const className = findKey(doc?.data?.tags, "data")?.find?.((t) => t.groupSlug === "class")?.name || null;

  return {
    source: "mobalytics",
    url,
    name: data.name,
    className,
    importedAt: Date.now(),
    variants: data.buildVariants.values.map((v) => ({
      id: v.id,
      name: titles[v.id] || v.name || `Variante ${v.id}`,
      slots: (v.genericBuilder?.slots || []).map((s) => convertSlot(s, matcher, dict)),
      priority: (v.equipmentPriorityList || []).map((p) => ({
        slug: p.slug,
        slot: p.type,
        modifiers: (p.modifiers || []).map((m) => ({ slug: m.slug, type: m.type })),
      })),
      skills: (v.assignedSkills?.skills || []).map((s) => s.skill?.name).filter(Boolean),
      spiritGuardians: v.assignedSkills?.spiritGuardians || null,
      paragon: (v.paragon?.boards || []).map((b) => ({ board: humanize(b.board?.slug || ""), glyph: b.glyph ? humanize(b.glyph.slug) : null, glyphLevel: b.glyphLevel })),
      // Compétences (rangs, modificateurs) et Parangon (nœuds rares, glyphes) : verdict au survol
      plan: planFromMobalytics(v, dict, className),
    })),
  };
}

// ---------- Maxroll (planificateur ou guide de build) ----------

// Emplacement d'après l'identifiant d'objet Maxroll (« S14_Ring_Unique_Generic_104 »…)
const MAXROLL_SLOTS = [
  [/^(S\d+_)?Helm_/i, "helm"], [/^(S\d+_)?Chest_/i, "chest-armor"], [/^(S\d+_)?Gloves_/i, "gloves"],
  [/^(S\d+_)?(Pants|Legs)_/i, "pants"], [/^(S\d+_)?Boots_/i, "boots"], [/^(S\d+_)?Amulet_/i, "amulet"],
  [/^(S\d+_)?Ring_/i, "ring"], [/^(S\d+_)?(Shield|Focus|OffHand|Totem)/i, "offhand"],
  [/^Talisman_Seal/i, "seal"], [/^Talisman_Charm/i, "charm"],
  [/^(S\d+_)?(1H|2H|Quarterstaff|Glaive|Staff|Wand|Bow|Crossbow|Dagger|Polearm|Scythe|Flail|Spear|Sword|Axe|Mace)/i, "weapon"],
];

function maxrollAffix(entry, matcher, dict) {
  const a = dict.maxrollAffixes?.[entry.nid];
  const attr = a?.attrs?.[0];
  if (!attr?.name || /^Affix_Value/i.test(attr.name)) return null; // valeur interne d'un pouvoir unique
  const key = dict.affixes[attr.name] ? attr.name : Object.keys(dict.affixes).find((k) => k.startsWith(attr.name + "#")) || attr.name;
  const fam = matcher.familyOfKey(key, attr.param);
  return { slug: a.key, key: fam.key, keys: fam.keys, must: fam.must, label: fam.label, greater: !!entry.greater, masterwork: false };
}

async function importMaxroll(url, matcher, dict) {
  let id = url.match(/maxroll\.gg\/d4\/planner\/([a-z0-9]+)/i)?.[1];
  let profileIndex = Number(url.match(/#(\d+)/)?.[1]);
  if (!id) {
    // Guide de build : la page embarque le lien de son planificateur
    const html = await (await httpGet(url, { "User-Agent": UA, Accept: "text/html" })).text();
    const planner = html.match(/https:\/\/maxroll\.gg\/d4\/planner\/([a-z0-9]+)(?:#(\d+))?/i);
    if (!planner) throw new Error("Aucun planificateur trouvé dans ce guide Maxroll.");
    id = planner[1];
    if (planner[2]) profileIndex = Number(planner[2]);
  }
  const res = await httpGet(`https://planners.maxroll.gg/profiles/d4/${id}`, { "User-Agent": UA, Accept: "application/json" });
  if (!res.ok) throw new Error(`Maxroll : planificateur introuvable (${res.status})`);
  const all = await res.json();
  const data = typeof all.data === "string" ? JSON.parse(all.data) : all.data;

  const variants = data.profiles
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => !p.hidden)
    .map(({ p, index }) => {
      let rings = 0;
      let weapons = 0;
      const slots = [];
      for (const itemRef of Object.values(p.items || {})) {
        const it = data.items[itemRef];
        if (!it) continue;
        let slot = MAXROLL_SLOTS.find(([re]) => re.test(it.id))?.[1];
        if (!slot) continue;
        if (slot === "ring") slot = `ring-${++rings}`;
        if (slot === "weapon") slot = ++weapons === 1 ? "weapon" : `weapon-${weapons}`;
        const unique = dict.uniques[it.id] || dict.uniques[it.id.replace(/^S\d+_/, "")];
        const aspectKey = it.aspects?.[0] && dict.maxrollAffixes?.[it.aspects[0].nid]?.key;
        const aspect = aspectKey && dict.aspects?.[aspectKey];
        const isUnique = /_Unique_/i.test(it.id);
        slots.push({
          slot,
          slotName: SLOT_NAMES[slot] || (slot.startsWith("weapon") ? "Arme" : humanize(slot)),
          kind: isUnique ? "unique" : aspect ? "aspect" : "other",
          title: isUnique ? unique?.en || humanize(it.id) : aspect ? `Aspect ${aspect.en}` : it.name || "",
          titleFr: isUnique ? unique?.fr || null : aspect ? `Aspect ${aspect.fr}` : null,
          aspectFr: aspect?.fr || null,
    aspectForms: aspect?.frForms || null,
          affixes: (it.explicits || []).map((e) => maxrollAffix(e, matcher, dict)).filter(Boolean),
          tempering: (it.tempered || []).map((e) => maxrollAffix(e, matcher, dict)).filter(Boolean),
          gems: (it.sockets || []).map((g) => humanize(String(g).replace(/_/g, "-").toLowerCase())),
        });
      }
      return {
        id: String(index),
        name: p.name || `Profil ${index + 1}`,
        slots,
        priority: [],
        skills: (p.skillBar || []).map((k) => dict.skills[k]?.fr || dict.skills[k]?.en || humanize(String(k).replace(/_/g, "-"))),
        paragon: [],
      };
    });
  if (!variants.length) throw new Error("Ce planificateur Maxroll ne contient aucun profil visible.");
  const preferred = Number.isFinite(profileIndex) ? variants.find((v) => v.id === String(profileIndex)) : null;
  return { source: "maxroll", url, name: all.name || "Build Maxroll", className: all.class || null, importedAt: Date.now(), variants, preferredVariant: preferred?.id };
}

// ---------- D4Builds (site interactif : lu dans une fenêtre Chromium invisible) ----------

async function importD4Builds(url, matcher, dict) {
  const { BrowserWindow } = require("electron");
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { offscreen: false } });
  try {
    await win.loadURL(url, { userAgent: UA });
    // La page se construit en JavaScript : on attend la liste des caractéristiques
    let data = null;
    for (let i = 0; i < 40 && !data; i++) {
      await new Promise((r) => setTimeout(r, 500));
      data = await win.webContents.executeJavaScript(`(() => {
        const groups = [...document.querySelectorAll('.builder__stats__group')];
        if (!groups.length) return null;
        const text = (el) => (el?.value || el?.textContent || '').trim();
        return {
          name: text(document.querySelector('.builder__header__input')) || document.title,
          className: text(document.querySelector('.builder__header__name')),
          variant: text(document.querySelector('.builder__variant__input')),
          groups: groups.map((g) => ({
            slot: text(g.querySelector('.builder__stats__slot')),
            stats: [...g.querySelectorAll('.dropdown__button__wrapper')].map((s) => ({
              text: text(s), greater: !!s.querySelector('.greater__affix__button--filled'),
              tempered: !!s.querySelector('img[src*="tempering_02.png"]'),
            })),
          })),
          gear: [...document.querySelectorAll('.builder__gear__item:not(.disabled)')].map((it) => ({
            slot: text(it.querySelector('.builder__gear__slot')),
            name: text(it.querySelector('.builder__gear__name')),
            unique: !!it.querySelector('[class*="builder__gear__name--"]'),
          })),
        };
      })()`);
    }
    if (!data) throw new Error("D4Builds : la page n'a pas pu être lue (build privé ou format modifié).");

    const slotOf = (label) => {
      const l = clean(label);
      if (/helm/.test(l)) return "helm";
      if (/chest/.test(l)) return "chest-armor";
      if (/glove/.test(l)) return "gloves";
      if (/pant|leg/.test(l)) return "pants";
      if (/boot/.test(l)) return "boots";
      if (/amulet/.test(l)) return "amulet";
      if (/ring/.test(l)) return "ring";
      if (/offhand|off hand|shield|focus|totem/.test(l)) return "offhand";
      if (/weapon|bludgeon|slash|dual|ranged/.test(l)) return "weapon";
      return null;
    };
    let rings = 0;
    let weapons = 0;
    const slots = [];
    for (const g of data.groups) {
      let slot = slotOf(g.slot);
      if (!slot) continue;
      if (slot === "ring") slot = `ring-${++rings}`;
      if (slot === "weapon") slot = ++weapons === 1 ? "weapon" : `weapon-${weapons}`;
      const gear = data.gear.find((x) => slotOf(x.slot) === slot.replace(/-\d$/, "")) || {};
      const aspect = !gear.unique && gear.name ? findAspect(gear.name, dict) : null;
      const unique = gear.unique ? Object.values(dict.uniques).find((u) => clean(u.en) === clean(gear.name)) : null;
      const toAffix = (st) => {
        const m = matcher.matchLine(st.text);
        if (!m.key || m.score < 0.5) return null;
        const fam = matcher.familyOfKey(m.key);
        return { slug: clean(st.text).replace(/\s+/g, "-"), key: fam.key, keys: fam.keys, must: fam.must, label: fam.label, greater: st.greater, masterwork: false };
      };
      slots.push({
        slot,
        slotName: SLOT_NAMES[slot] || (slot.startsWith("weapon") ? "Arme" : humanize(slot)),
        kind: gear.unique ? "unique" : aspect ? "aspect" : "other",
        title: gear.name || "",
        titleFr: unique?.fr || (aspect ? `Aspect ${aspect.fr}` : null),
        aspectFr: aspect?.fr || null,
    aspectForms: aspect?.frForms || null,
        affixes: g.stats.filter((s) => !s.tempered).map(toAffix).filter(Boolean),
        tempering: g.stats.filter((s) => s.tempered).map(toAffix).filter(Boolean),
        gems: [],
      });
    }
    return {
      source: "d4builds", url, name: data.name, className: data.className || null, importedAt: Date.now(),
      variants: [{ id: "0", name: data.variant || "Build", slots, priority: [], skills: [], paragon: [] }],
    };
  } finally {
    win.destroy();
  }
}

async function importBuild(url, matcher, dict) {
  const u = url.trim();
  if (/mobalytics\.gg\/(fr\/)?diablo-4\//i.test(u)) return importMobalytics(u.replace("/fr/diablo-4/", "/diablo-4/"), matcher, dict);
  if (/maxroll\.gg\/d4\/(planner|build-guides)\//i.test(u)) return importMaxroll(u, matcher, dict);
  if (/d4builds\.gg\/builds\//i.test(u)) return importD4Builds(u, matcher, dict);
  throw new Error("Lien non reconnu. Sites pris en charge : Mobalytics, Maxroll (planificateur ou guide), D4Builds.");
}

// Build vierge, à remplir soi-même dans le panneau Diablo IV
function emptyBuild(name, className) {
  const slots = ["helm", "chest-armor", "gloves", "pants", "boots", "weapon", "offhand", "amulet", "ring-1", "ring-2"].map((slot) => ({
    slot, slotName: SLOT_NAMES[slot], kind: "other", title: "", titleFr: null, aspectFr: null, affixes: [], tempering: [], gems: [],
  }));
  return { source: "manuel", url: null, name: name || "Mon build", className: className || null, importedAt: Date.now(), variants: [{ id: "0", name: "Principal", slots, priority: [], skills: [], paragon: [] }] };
}

// Recalcule les familles d'affixes et les aspects d'un build déjà importé (après une mise à jour de l'app)
function refreshBuildKeys(build, matcher) {
  for (const v of build?.variants || []) {
    for (const slot of v.slots) {
      if (slot.kind === "aspect" && slot.title && !slot.aspectForms) {
        const aspect = findAspect(slot.title, matcher.dict);
        if (aspect) Object.assign(slot, { aspectFr: aspect.fr, aspectForms: aspect.frForms, titleFr: `Aspect ${aspect.fr}` });
      }
      for (const a of [...slot.affixes, ...slot.tempering]) {
        if (a.terms || a.manual || a.keys?.length > 1) continue; // ajout manuel ou import Maxroll/D4Builds : déjà complet
        const m = matcher.matchSlug(a.slug);
        if (m.key) Object.assign(a, { key: m.key, keys: m.keys, must: m.must });
      }
    }
  }
}

module.exports = { importBuild, refreshBuildKeys, emptyBuild, SLOT_NAMES };
