// Panneau Diablo IV : builds (import multi-sites, build vierge, variante), priorités modifiables,
// équipement porté face au build, connexion au jeu et scan.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SOURCES = { mobalytics: "Mobalytics", maxroll: "Maxroll", d4builds: "D4Builds", manuel: "Perso" };
const STATUS = { off: ["off", "Jeu : écoute arrêtée"], listening: ["off", "Jeu : en attente (survole un objet)"], connected: ["on", "Jeu : connecté ✓"], busy: ["bad", "Jeu : canal occupé (ferme D4LF)"], error: ["bad", "Jeu : erreur"] };

let summary = null;
let draft = null; // copie modifiable de la variante (onglet Priorités)
let dirty = false;
let affixChoices = [];

// ---------- Onglets ----------
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + b.dataset.tab));
    if (b.dataset.tab === "equip") loadEquipment();
  })
);

// ---------- Rendu général ----------
function render(sum) {
  if (!sum) return;
  summary = sum;
  const [cls, text] = STATUS[sum.status] || ["off", "Jeu : " + sum.status];
  $("status").className = "status " + cls;
  $("status").textContent = text;
  $("connStatus").innerHTML = `<span class="${cls === "on" ? "ok" : cls === "bad" ? "ko" : "muted"}">${esc(text)}</span>`;
  $("activeName").textContent = sum.build ? `${sum.build.name}${sum.build.className ? " · " + sum.build.className : ""}` : "Aucun build";

  // Liste des builds
  $("builds").innerHTML = sum.builds.length
    ? sum.builds.map((b) => `
      <div class="build ${b.id === sum.activeBuildId ? "active" : ""}" data-id="${b.id}">
        <input type="radio" name="active" ${b.id === sum.activeBuildId ? "checked" : ""}>
        <div><div class="name">${esc(b.name)}</div>
          <div class="row" style="gap:6px"><span class="badge src">${SOURCES[b.source] || b.source}</span>${b.className ? `<span class="badge">${esc(b.className)}</span>` : ""}${b.edited ? '<span class="badge">modifié</span>' : ""}</div></div>
        <div class="row" style="gap:2px">
          <button class="icon" data-act="rename" title="Renommer">✎</button>
          <button class="icon" data-act="delete" title="Supprimer">🗑</button>
        </div>
      </div>`).join("")
    : '<div class="muted">Aucun build : importe un lien ou crée le tien.</div>';

  // Variante
  $("variantCard").style.display = sum.build ? "" : "none";
  if (sum.build) {
    $("variant").innerHTML = sum.build.variants.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
    $("variant").value = sum.build.variantId;
  }
  const eq = Object.keys(sum.equipped).length;
  $("calibInfo").textContent = `Équipement connu : ${eq}/10 pièces · Inventaire : ${sum.calibrated.inventory ? "calibré ✓" : "à calibrer"}`;
  if (!dirty) {
    draft = sum.variant ? JSON.parse(JSON.stringify(sum.variant)) : null;
    renderPriorities();
  }
}

$("builds").addEventListener("click", async (e) => {
  const card = e.target.closest(".build");
  if (!card) return;
  const id = card.dataset.id;
  const act = e.target.dataset.act;
  if (act === "delete") {
    if (confirm("Supprimer ce build ?")) render(await window.api.invoke("d4:delete-build", id));
  } else if (act === "rename") {
    // Renommage sur place (Electron ne gère pas prompt())
    const nameEl = card.querySelector(".name");
    const input = document.createElement("input");
    input.type = "text";
    input.value = nameEl.textContent;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const done = async () => render(await window.api.invoke("d4:rename-build", { id, name: input.value }));
    input.addEventListener("keydown", (k) => k.key === "Enter" && input.blur());
    input.addEventListener("blur", done, { once: true });
    input.addEventListener("click", (k) => k.stopPropagation());
  } else if (e.target.tagName === "INPUT" && e.target.type === "text") {
    return;
  } else if (id !== summary.activeBuildId) {
    if (dirty && !confirm("Des modifications de priorités ne sont pas enregistrées. Changer de build quand même ?")) return;
    dirty = false;
    render(await window.api.invoke("d4:active-build", id));
  }
});

$("import").onclick = async () => {
  const url = $("url").value.trim();
  if (!url) return;
  $("importInfo").textContent = /d4builds/.test(url) ? "Import en cours (D4Builds se charge dans une fenêtre invisible, ~5 s)…" : "Import en cours…";
  $("import").disabled = true;
  const r = await window.api.invoke("d4:import", url);
  $("import").disabled = false;
  if (r.ok) {
    dirty = false;
    render(r.summary);
    $("importInfo").textContent = `✓ « ${r.summary.build.name} » importé (${r.summary.build.variants.length} variante(s)).`;
    $("url").value = "";
  } else {
    $("importInfo").textContent = "✗ " + r.error;
  }
};

$("newBuild").onclick = async () => {
  const name = $("newName").value.trim() || "Mon build";
  dirty = false;
  render(await window.api.invoke("d4:new-build", { name }));
  $("newName").value = "";
  document.querySelector('nav button[data-tab="prio"]').click();
};

$("variant").onchange = async () => {
  dirty = false;
  render(await window.api.invoke("d4:variant", $("variant").value));
};

// ---------- Priorités ----------
function setDirty(on = true) {
  dirty = on;
  $("savebar").classList.toggle("on", on);
}

function affixRows(slotIndex, list, kind) {
  return list
    .map((a, i) => `
    <div class="affix" data-slot="${slotIndex}" data-kind="${kind}" data-i="${i}">
      <span class="n">${i + 1}</span>
      <span>${esc(a.label)}</span>
      <span class="tools">
        <button class="icon star ${a.greater ? "on" : ""}" data-op="star" title="Voulu en affixe supérieur">★</button>
        <button class="icon" data-op="up" title="Plus prioritaire">▲</button>
        <button class="icon" data-op="down" title="Moins prioritaire">▼</button>
        <button class="icon" data-op="del" title="Retirer">✕</button>
      </span>
    </div>`)
    .join("");
}

function renderPriorities() {
  if (!draft) {
    $("slots").innerHTML = '<div class="muted">Aucun build actif.</div>';
    return;
  }
  $("slots").innerHTML = draft.slots
    .map((s, si) => {
      if (/charm|seal|power|talisman/i.test(s.slot) && !s.affixes.length) return "";
      return `
      <div class="card slot">
        <h3>${esc(s.slotName)} <small>${s.kind === "unique" ? "unique" : s.kind === "aspect" ? "aspect" : ""}</small></h3>
        <input type="text" data-slot="${si}" data-field="title" value="${esc(s.titleFr || s.title)}" placeholder="Objet unique ou aspect visé (facultatif)" style="width:100%">
        <div class="sub">Affixes</div>
        ${affixRows(si, s.affixes, "affixes") || '<div class="hint">Aucun affixe : ajoute ceux que tu veux.</div>'}
        <div class="add"><input type="text" list="affixList" data-slot="${si}" data-kind="affixes" placeholder="+ ajouter un affixe…"></div>
        <div class="sub">Trempes</div>
        ${affixRows(si, s.tempering, "tempering") || '<div class="hint">—</div>'}
        <div class="add"><input type="text" list="affixList" data-slot="${si}" data-kind="tempering" placeholder="+ ajouter une trempe…"></div>
        ${s.gems?.length ? `<div class="hint">Gemmes : ${esc(s.gems.join(", "))}</div>` : ""}
      </div>`;
    })
    .join("");
}

$("slots").addEventListener("click", (e) => {
  const op = e.target.dataset.op;
  const row = e.target.closest(".affix");
  if (!op || !row) return;
  const list = draft.slots[row.dataset.slot][row.dataset.kind];
  const i = Number(row.dataset.i);
  if (op === "star") list[i].greater = !list[i].greater;
  if (op === "del") list.splice(i, 1);
  if (op === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  if (op === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  setDirty();
  renderPriorities();
});

$("slots").addEventListener("change", (e) => {
  const t = e.target;
  const slot = draft.slots[t.dataset.slot];
  if (!slot) return;
  if (t.dataset.field === "title") {
    slot.title = slot.titleFr = t.value.trim();
    setDirty();
    return;
  }
  const choice = affixChoices.find((c) => c.label === t.value.trim());
  if (!choice) return;
  slot[t.dataset.kind].push({ slug: choice.key, key: choice.key, keys: [], must: [], label: choice.label, greater: false, manual: true });
  setDirty();
  renderPriorities();
});

$("save").onclick = async () => {
  const r = await window.api.invoke("d4:save-variant", { buildId: summary.activeBuildId, variant: draft });
  if (!r.ok) return alert(r.error);
  setDirty(false);
  render(r.summary);
};
$("cancel").onclick = () => {
  setDirty(false);
  render(summary);
};

// ---------- Équipement ----------
async function loadEquipment() {
  const { equipment, inventory } = await window.api.invoke("d4:equipment");
  $("equipRows").innerHTML = equipment.length
    ? equipment.map((r) => `
      <tr>
        <td><b>${esc(r.slotName)}</b></td>
        <td>${esc(r.target || "—")}<div class="hint">${esc(r.wanted.join(" · "))}</div></td>
        <td>${r.item ? `${esc(r.item.name)}<div class="hint">${esc(r.item.typeLine)}${r.item.power ? " · " + r.item.power : ""}</div>` : '<span class="muted">non synchronisé</span>'}</td>
        <td>${r.verdict ? `<span class="v v-${r.verdict.level}">${esc(r.verdict.text)}</span>` : ""}
          ${r.aspect ? `<div class="${r.aspect.has ? "ok" : "ko"}">${r.aspect.has ? "✓" : "✗"} ${esc(r.aspect.label)}</div>` : ""}
          ${r.checks.map((c) => `<div class="${c.wanted ? "ok" : "muted"}">${c.wanted ? "✓" : "✗"} ${esc(c.text.replace(/\s*\[[^\]]*\]\s*%?/g, " "))}</div>`).join("")}
          ${r.item && r.missing.length ? `<div class="hint">Manque : ${esc(r.missing.join(" · "))}</div>` : ""}</td>
      </tr>`).join("")
    : '<tr><td colspan="4" class="muted">Importe un build pour comparer ton équipement.</td></tr>';
  $("invRows").innerHTML = inventory.length
    ? inventory.map((c) => `<div>${c.verdict ? `<span class="v v-${c.verdict.level}">${esc(c.verdict.text)}</span>` : ""} ${esc(c.name)} <span class="muted">${esc(c.slotName || "")} · case ${c.row + 1}-${c.col + 1}</span></div>`).join("")
    : "Aucun scan pour l'instant.";
}
$("refreshEquip").onclick = loadEquipment;

let syncing = false;
$("sync").onclick = async () => {
  syncing = !syncing;
  render(await window.api.invoke("d4:sync", syncing));
  $("sync").textContent = syncing ? "Masquer la liste de contrôle" : "Liste de contrôle";
};

// ---------- Connexion & scan ----------
$("calib").onclick = () => window.api.invoke("d4:calibrate");
$("card").onchange = () => window.api.invoke("d4:settings", { d4ItemCard: $("card").checked });

// ---------- Démarrage et mises à jour en direct ----------
window.api.on("d4:summary", (s) => {
  render(s);
  if (document.querySelector("#tab-equip.on")) loadEquipment();
});
window.api.on("d4:status", async () => render(await window.api.invoke("d4:summary")));

(async () => {
  render(await window.api.invoke("d4:summary"));
  const st = await window.api.invoke("d4:settings");
  $("card").checked = st.d4ItemCard;
  $("scanInfo").textContent = `Scan : touche ${st.scanKey} (inventaire ouvert). Le 1er appui lance le calibrage. Échap pour arrêter. Modifiable dans Paramètres → Raccourcis.`;
  affixChoices = await window.api.invoke("d4:affix-choices");
  $("affixList").innerHTML = affixChoices.map((c) => `<option value="${esc(c.label)}">`).join("");
})();
