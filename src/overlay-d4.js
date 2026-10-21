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

  window.api.on("d4-item", ({ item, eval: ev, variant }) => {
    if (!ev) {
      show(`<div class="d4-head"><span class="d4-name">${esc(item.name)}</span><span class="d4-slot">${esc(item.typeLine)}</span></div>
        <div class="d4-foot">Emplacement absent du build importé.</div>`, 6000);
      return;
    }
    // ✓ prioritaire pour l'emplacement · ~ utile ailleurs dans le build ou proche · ✗ inutile.
    // À droite : écart avec la pièce portée (donné par le jeu) et qualité du tirage.
    const TAGS = { prio: ["✓", "d4-ok", ""], build: ["~", "d4-mid", "utile au build"], near: ["~", "d4-mid", "proche du build"], none: ["✗", "d4-ko", ""] };
    const rows = ev.checks
      .map((c) => {
        const [icon, cls, tag] = TAGS[c.tag] || (c.wanted ? TAGS.prio : TAGS.none);
        const q = c.quality == null ? "<span></span>" : `<div class="d4-bar" title="${Math.round(c.quality * 100)} % de la fourchette"><i style="width:${Math.round(c.quality * 100)}%"></i></div>`;
        const d = !c.delta ? "<span></span>" : c.delta === "nouveau" ? '<span class="d4-d new" title="Absent de la pièce portée">nouveau</span>' : `<span class="d4-d ${c.delta.startsWith("+") ? "up" : "down"}" title="Écart avec la pièce portée">${esc(c.delta)}</span>`;
        return `<div class="d4-row ${c.tag === "none" ? "no" : ""}">
          <span class="${cls}">${icon}</span>
          <span>${esc(c.text)}${c.greaterWanted ? ' <span class="d4-star" title="Le build le veut en affixe supérieur">★</span>' : ""}${tag ? `<span class="d4-tag">${tag}</span>` : ""}</span>
          ${d}${c.tag === "none" ? "<span></span>" : q}
        </div>`;
      })
      .join("");
    const aspectRow = ev.aspect
      ? `<div class="d4-row ${ev.aspect.has ? "" : "no"}"><span class="${ev.aspect.has ? "d4-ok" : "d4-ko"}">${ev.aspect.has ? "✓" : "✗"}</span><span>${esc(ev.aspect.label)}</span><span></span></div>`
      : "";
    // Bilan face à la pièce portée : ce qu'on gagne / ce qu'on perd, pondéré par le build
    const cmp = ev.compare;
    const upgrade = cmp
      ? `<div class="d4-cmp">Face à ${esc(cmp.than)} :${cmp.gains.length ? `<div class="up">▲ ${esc(cmp.gains.slice(0, 4).join(" · "))}</div>` : ""}${cmp.losses.length ? `<div class="down">▼ ${esc(cmp.losses.slice(0, 4).join(" · "))}</div>` : ""}</div>`
      : "";
    const missing = ev.missing.length ? `<div class="d4-foot">Manque : ${esc(ev.missing.join(" · "))}</div>` : "";
    const target = ev.target ? `<div class="d4-foot">Visé : ${esc(ev.target)}</div>` : "";
    // Utile pour une autre variante du build (Endgame quand on suit le Starter…)
    const later = (ev.later || [])
      .map((l) => `<div class="d4-later"><b>↗ ${esc(l.variant)}</b> : ${esc(l.text)}${l.target ? `<span> · visé : ${esc(l.target)}</span>` : ""}</div>`)
      .join("");
    // Préciser pour quel build est le détail ✓ / ✗ : celui du verdict « à garder pour… », sinon la
    // variante suivie quand d'autres builds sont cités
    const detailFor = ev.detailFor
      ? `<div class="d4-foot" style="margin:0 0 2px">Détail pour ${esc(ev.detailFor)} :</div>`
      : later && variant ? `<div class="d4-foot" style="margin:0 0 2px">Détail pour ${esc(variant)} (variante suivie) :</div>` : "";
    show(
      `<div class="d4-head"><span class="d4-name">${esc(item.name)}</span><span class="d4-slot">${esc(ev.slotName)}${item.power ? ` · ${item.power}` : ""}</span></div>
       <div class="d4-verdict v-${ev.verdict.level}">${esc(ev.verdict.text)}</div>
       ${later}${detailFor}${aspectRow}${rows}${upgrade}${missing}${target}`,
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
    const rows = keep.map((k) => `<div class="d4-row"><span class="${k.level === "later" ? "d4-later-i" : "d4-ok"}">${k.level === "top" ? "★" : k.level === "later" ? "↗" : "✓"}</span><span>${esc(k.name)} <span class="d4-slot">${esc(k.slot)}</span></span><span></span></div>`).join("");
    show(`<div class="d4-head"><span class="d4-name">Scan ${aborted ? "interrompu" : "terminé"}</span><span class="d4-slot">${total} objets</span></div>
      <div class="d4-verdict ${keep.length ? "v-top" : "v-neutral"}">${keep.length} à garder · ${salvage} à recycler</div>${rows}
      <div class="d4-foot">Les repères ✓ / ✗ sont affichés sur ton sac pendant 30 s.</div>`, 30000);
  });
})();
