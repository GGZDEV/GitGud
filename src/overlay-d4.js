// Diablo IV dans l'overlay : fiche de l'objet survolé (✓ / ✗ par affixe, qualité du tirage,
// verdict), suivi de la synchronisation de l'équipement et résumé du scan d'inventaire.
(function () {
  const card = document.getElementById("d4card");
  let hideTimer = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const SLOT_LABELS = {
    helm: "Casque", "chest-armor": "Torse", gloves: "Gants", pants: "Jambières", boots: "Bottes",
    weapon: "Arme", offhand: "Main gauche", amulet: "Amulette", "ring-1": "Anneau 1", "ring-2": "Anneau 2",
  };

  function show(html, ms) {
    card.innerHTML = html;
    card.classList.add("on");
    clearTimeout(hideTimer);
    if (ms) hideTimer = setTimeout(() => card.classList.remove("on"), ms);
  }

  window.api.on("d4-item", ({ item, eval: ev }) => {
    if (!ev) {
      show(`<div class="d4-head"><span class="d4-name">${esc(item.name)}</span><span class="d4-slot">${esc(item.typeLine)}</span></div>
        <div class="d4-foot">Emplacement absent du build importé.</div>`, 6000);
      return;
    }
    const rows = ev.checks
      .map((c) => {
        const q = c.quality == null ? "" : `<div class="d4-bar" title="${Math.round(c.quality * 100)} % de la fourchette"><i style="width:${Math.round(c.quality * 100)}%"></i></div>`;
        return `<div class="d4-row ${c.wanted ? "" : "no"}">
          <span class="${c.wanted ? "d4-ok" : "d4-ko"}">${c.wanted ? "✓" : "✗"}</span>
          <span>${esc(c.text.replace(/\s*\[[^\]]*\]\s*%?/g, " ").trim())}${c.greaterWanted ? ' <span class="d4-star" title="Le build le veut en affixe supérieur">★</span>' : ""}</span>
          ${c.wanted ? q : "<span></span>"}
        </div>`;
      })
      .join("");
    const aspectRow = ev.aspect
      ? `<div class="d4-row ${ev.aspect.has ? "" : "no"}"><span class="${ev.aspect.has ? "d4-ok" : "d4-ko"}">${ev.aspect.has ? "✓" : "✗"}</span><span>${esc(ev.aspect.label)}</span><span></span></div>`
      : "";
    const upgrade = ev.upgrade ? `<div class="d4-foot">${ev.upgrade.better ? "▲ Mieux" : ev.upgrade.worse ? "▼ Moins bien" : "= Équivalent"} que ${esc(ev.upgrade.than)} (${ev.upgrade.currentWanted}/${ev.upgrade.currentTotal})</div>` : "";
    const missing = ev.missing.length ? `<div class="d4-foot">Manque : ${esc(ev.missing.join(" · "))}</div>` : "";
    const target = ev.target ? `<div class="d4-foot">Visé : ${esc(ev.target)}</div>` : "";
    show(
      `<div class="d4-head"><span class="d4-name">${esc(item.name)}</span><span class="d4-slot">${esc(ev.slotName)}${item.power ? ` · ${item.power}` : ""}</span></div>
       <div class="d4-verdict v-${ev.verdict.level}">${esc(ev.verdict.text)}</div>
       ${aspectRow}${rows}${upgrade}${missing}${target}`,
      12000
    );
  });

  window.api.on("d4-sync", ({ slot, item, done, slots }) => {
    const list = slots.map((s) => `<span class="${done.includes(s) ? "done" : ""}">${done.includes(s) ? "✓" : "○"} ${SLOT_LABELS[s] || s}</span>`).join("");
    const last = slot ? `<div class="d4-foot">Enregistré : ${esc(SLOT_LABELS[slot] || slot)} — ${esc(item?.name)}</div>` : "";
    show(`<div class="d4-head"><span class="d4-name">Synchronisation de l'équipement</span></div>
      <div class="d4-foot">Ouvre l'inventaire et survole chacune de tes pièces portées.</div>
      <div class="d4-sync">${list}</div>${last}`, 0);
  });

  window.api.on("d4-scan", ({ aborted, total, keep, salvage }) => {
    const rows = keep.map((k) => `<div class="d4-row"><span class="d4-ok">${k.level === "top" ? "★" : "✓"}</span><span>${esc(k.name)} <span class="d4-slot">${esc(k.slot)}</span></span><span></span></div>`).join("");
    show(`<div class="d4-head"><span class="d4-name">Scan ${aborted ? "interrompu" : "terminé"}</span><span class="d4-slot">${total} objets</span></div>
      <div class="d4-verdict ${keep.length ? "v-top" : "v-neutral"}">${keep.length} à garder · ${salvage} à recycler</div>${rows}
      <div class="d4-foot">Les repères ✓ / ✗ sont affichés sur ton sac pendant 30 s.</div>`, 30000);
  });
})();
