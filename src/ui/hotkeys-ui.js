// Éditeur de raccourcis (paramètres et assistant). Clic sur « Changer », puis appuie sur la
// touche ou le bouton de souris voulu : la capture se fait au niveau système, comme en jeu.
(function () {
  const same = (a, b) =>
    a && b && a.type === b.type && a.keycode === b.keycode && a.button === b.button &&
    !!a.alt === !!b.alt && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.meta === !!b.meta;

  // Monte l'éditeur dans container. Retourne { get } → raccourcis choisis.
  async function mount(container) {
    const info = await window.api.invoke("hotkeys:get");
    const bindings = { ...info.bindings };
    const labels = { ...info.labels };
    container.innerHTML = "";

    if (!info.available) {
      container.innerHTML = '<div class="hint">Personnalisation indisponible sur ce PC : raccourcis par défaut (Alt+V, Alt+T, Alt+X, Alt+O).</div>';
      return { get: () => bindings };
    }

    const rows = {};
    for (const [action, text] of Object.entries(info.actions)) {
      const row = document.createElement("div");
      row.className = "hk-row";
      row.innerHTML = `<span class="hk-action"></span><kbd class="hk-key"></kbd><button type="button" class="ghost small">Changer</button>`;
      row.querySelector(".hk-action").textContent = text;
      row.querySelector(".hk-key").textContent = labels[action];
      const btn = row.querySelector("button");
      btn.onclick = async () => {
        btn.disabled = true;
        row.querySelector(".hk-key").textContent = "Appuie sur la touche ou la combinaison… (Échap : annuler)";
        row.classList.add("capturing");
        const r = await window.api.invoke("hotkeys:capture", action);
        row.classList.remove("capturing");
        btn.disabled = false;
        if (r) {
          // Raccourci déjà pris par une autre action : on échange les deux.
          const other = Object.keys(bindings).find((a) => a !== action && same(bindings[a], r.binding));
          if (other) {
            bindings[other] = bindings[action];
            labels[other] = labels[action];
            rows[other].querySelector(".hk-key").textContent = labels[other];
          }
          bindings[action] = r.binding;
          labels[action] = r.label;
        }
        row.querySelector(".hk-key").textContent = labels[action];
      };
      rows[action] = row;
      container.appendChild(row);
    }

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ghost small";
    reset.textContent = "Raccourcis par défaut";
    reset.onclick = async () => {
      window.api.invoke("hotkeys:cancel");
      const defaults = await window.api.invoke("hotkeys:defaults");
      Object.assign(bindings, defaults.bindings);
      Object.assign(labels, defaults.labels);
      for (const a of Object.keys(rows)) rows[a].querySelector(".hk-key").textContent = labels[a];
    };
    container.appendChild(reset);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "N'importe quelle touche seule (F10…) ou combinaison (Ctrl + A, Maj + F2…), bouton latéral de souris, ou bouton de manette Xbox / compatible. Maintiens les modificateurs puis appuie sur la touche.";
    container.appendChild(hint);

    return { get: () => bindings };
  }

  window.HotkeysUI = { mount };
})();
