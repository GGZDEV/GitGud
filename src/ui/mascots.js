// Mascottes (style emblème, SVG originaux animés en CSS via mascots.css). Chaque mascotte est
// un personnage complet (ton, voix : src/personalities.js) : réglage « mascot ».
// Utilisable dans toute page : <script src="ui/mascots.js"> puis Mascots.render(el, "slime", "idle").
(function () {
  const DEFAULT = "slime";

  // name : nom affiché · glow : halo (r,g,b) · tint : fond des vignettes de choix
  const META = {
    slime: { name: "Slime d'ombre", glow: "34,211,238", tint: "#08353a", desc: "Gelée sombre casquée, noyau runique qui pulse quand il parle." },
    mech: { name: "Unité K-1N", glow: "34,211,238", tint: "#0b2f3a", desc: "Casque d'IA tactique : scanner en réflexion, égaliseur vocal." },
    wraith: { name: "Spectre", glow: "139,92,246", tint: "#1d1440", desc: "Assassin encapuchonné, seul le regard brille." },
    wolf: { name: "Loup alpha", glow: "94,234,255", tint: "#122a40", desc: "Tête de loup à facettes, crocs visibles quand il parle." },
    lich: { name: "Liche", glow: "167,139,250", tint: "#2a1048", desc: "Crâne couronné, mâchoire qui s'anime à la parole." },
    orc: { name: "Chef de guerre", glow: "255,176,32", tint: "#3a2a0a", desc: "Orc à défenses, regard ambre, peinture de guerre." },
  };

  // Contenu des SVG (viewBox 0 0 120 120). {u} = suffixe unique pour les id (dégradés, découpes).
  const ART = {
    orc: `<g class="breathe" stroke-linejoin="round">
 <path d="M18 120 L24 100 L46 92 L60 100 L74 92 L96 100 L102 120Z" fill="#3a3f52" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M24 100 L46 92 L50 98 L28 107Z" fill="#5a6178"/>
 <path d="M30 101 L18 82 L41 95Z" fill="#8a91a8" stroke="#0b0a12" stroke-width="2"/>
 <path d="M90 101 L102 82 L79 95Z" fill="#8a91a8" stroke="#0b0a12" stroke-width="2"/>
 <path d="M38 50 L10 38 L20 50 L14 58 L36 66Z" fill="#5f9a3a" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M34 54 L20 46 L24 52 L33 61Z" fill="#3b6524"/>
 <path d="M82 50 L110 38 L100 50 L106 58 L84 66Z" fill="#4f8530" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M86 54 L100 46 L96 52 L87 61Z" fill="#2f531d"/>
 <circle cx="101" cy="57" r="3.2" fill="none" stroke="#a7aec4" stroke-width="1.8"/>
 <path d="M46 32 L50 12 L56 24 L60 5 L64 24 L70 12 L74 32Z" fill="#1d1a26" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M53 26 L67 26 L66 31 L54 31Z" fill="#8a91a8" stroke="#0b0a12" stroke-width="1.5"/>
 <path d="M36 42 L48 30 L72 30 L84 42 L88 62 L82 82 L70 96 L50 96 L38 82 L32 62Z" fill="#5f9a3a" stroke="#0b0a12" stroke-width="3"/>
 <path d="M60 30 L72 30 L84 42 L88 62 L82 82 L70 96 L60 96Z" fill="#2f531d" opacity=".5"/>
 <path d="M40 44 L49 34 L58 34 L50 40Z" fill="#8cc35a"/>
 <path d="M35 64 L40 80 L44 78Z" fill="#8cc35a" opacity=".6"/>
 <path d="M33 52 L46 45 L58 52 L62 52 L74 45 L87 52 L85 57 L74 51 L62 58 L58 58 L46 51 L35 57Z" fill="#2a4a1c" stroke="#0b0a12" stroke-width="2"/>
 <g class="blink tb"><g class="look go"><path d="M40 59 L55 61 L53 65 L42 63Z" fill="#ffc23a"/><path d="M80 59 L65 61 L67 65 L78 63Z" fill="#ffc23a"/></g></g>
 <path d="M70 41 L77 66" stroke="#c48f7a" stroke-width="1.6"/><path d="M71.5 49 L75 48 M73 56 L76.5 55" stroke="#c48f7a" stroke-width="1.2"/>
 <g fill="#8b5cf6"><path d="M41 67 L44 67 L43.4 77 L41.4 75Z"/><path d="M46 67 L49 67 L48.4 74 L46.4 72Z"/></g>
 <path d="M55 62 L65 62 L69 73 L60 75 L51 73Z" fill="#4a7f2e" stroke="#0b0a12" stroke-width="2"/>
 <path d="M54.5 71 L57.5 72 M65.5 71 L62.5 72" stroke="#0b0a12" stroke-width="1.8" stroke-linecap="round"/>
 <path class="talk" d="M44 80 L60 83.5 L76 80 L74 84 L60 87.5 L46 84Z" fill="#1a0f12" stroke="#0b0a12" stroke-width="1.5"/>
 <path d="M46 88 C45 80 47 74 51 70 C51 76 52 82 55 87Z" fill="#efe6cf" stroke="#0b0a12" stroke-width="2"/>
 <path d="M50.5 86 C50 80 50.4 76 51 72 C51.4 78 52 82 53.5 86Z" fill="#b9ab88"/>
 <path d="M74 88 C75 80 73 74 69 70 C69 76 68 82 65 87Z" fill="#efe6cf" stroke="#0b0a12" stroke-width="2"/>
 <path d="M69.5 86 C70 80 69.6 76 69 72 C68.6 78 68 82 66.5 86Z" fill="#b9ab88"/>
</g>`,

    wraith: `<g stroke-linejoin="round">
 <g fill="#7ef3ff"><circle class="ember" cx="30" cy="100" r="1.3"/><circle class="ember" cx="90" cy="96" r="1.1"/><circle class="ember" cx="70" cy="110" r="1"/></g>
 <g class="breathe">
 <path d="M12 120 L30 92 L60 104 L90 92 L108 120Z" fill="#17122b" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M60 8 L84 22 L96 50 L94 82 L82 104 L60 112 L38 104 L26 82 L24 50 L36 22Z" fill="#2a2148" stroke="#0b0a12" stroke-width="3"/>
 <path d="M60 8 L84 22 L96 50 L94 82 L82 104 L60 112Z" fill="#000" opacity=".28"/>
 <path d="M38 26 L57 11 L45 31Z" fill="#4a3b7a"/>
 <path d="M28 54 L34 40 L33 60Z" fill="#40336d"/>
 <path d="M36 22 L42 46 M84 22 L78 46 M29 70 L38 96 M91 70 L82 96" stroke="#3d3166" stroke-width="2"/>
 <path d="M60 30 L78 42 L82 64 L76 86 L60 96 L44 86 L38 64 L42 42Z" fill="#07060d" stroke="#0b0a12" stroke-width="3"/>
 <path d="M60 33.5 L75.5 44 L79 64 L73.5 84 L60 92.5 L46.5 84 L41 64 L44.5 44Z" fill="none" stroke="#22d3ee" stroke-width=".9" stroke-dasharray="3 2.5" opacity=".45"/>
 <g class="blink tb"><g class="look gc flick"><path d="M45 58 L57 61.5 L55 65 L46 62Z" fill="#a5f8ff"/><path d="M75 58 L63 61.5 L65 65 L74 62Z" fill="#a5f8ff"/></g></g>
 <path d="M42 70 L60 74 L78 70 L75 86 L60 94 L45 86Z" fill="#141022" stroke="#0b0a12" stroke-width="2"/>
 <path d="M60 74 L60 94 M48 76 L52 88 M72 76 L68 88" stroke="#251d40" stroke-width="1.4"/>
 <path class="ind" d="M60 79 L62.5 82 L60 85 L57.5 82Z" fill="#8b5cf6"/>
 <path d="M60 97 L67 104 L60 111 L53 104Z" fill="#8b5cf6" stroke="#c9a24a" stroke-width="2.2"/>
 <path d="M60 99.5 L63 103 L58 103Z" fill="#d8c8ff"/>
 </g>
</g>`,

    mech: `<g class="breathe" stroke-linejoin="round">
 <path d="M38 96 L82 96 L92 118 L28 118Z" fill="#1d2029" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M44 102 L76 102 M40 110 L80 110" stroke="#2f3341" stroke-width="2"/>
 <path d="M92 48 L101 22" stroke="#6b7190" stroke-width="2.5" stroke-linecap="round"/>
 <circle class="ind gc" cx="101" cy="21" r="2.2" fill="#22d3ee"/>
 <path d="M21 52 L30 47 L30 77 L21 72Z" fill="#3b3f52" stroke="#0b0a12" stroke-width="2.2"/>
 <path class="ind gc" d="M23.5 58 L27.5 57 L27.5 67 L23.5 66Z" fill="#22d3ee"/>
 <path d="M99 52 L90 47 L90 77 L99 72Z" fill="#2c303f" stroke="#0b0a12" stroke-width="2.2"/>
 <path class="ind gc" d="M96.5 58 L92.5 57 L92.5 67 L96.5 66Z" fill="#22d3ee"/>
 <path d="M60 10 L82 18 L92 40 L92 72 L84 92 L70 104 L50 104 L36 92 L28 72 L28 40 L38 18Z" fill="#3b3f52" stroke="#0b0a12" stroke-width="3"/>
 <path d="M38 18 L60 10 L82 18 L88 32 L60 26 L32 32Z" fill="#5b6079"/>
 <path d="M60 26 L88 32 L92 40 L92 72 L84 92 L70 104 L60 104Z" fill="#000" opacity=".22"/>
 <path d="M30 42 L36 22" stroke="#9aa1b8" stroke-width="2" stroke-linecap="round"/>
 <path d="M55.5 10.5 L64.5 10.5 L66 31 L54 31Z" fill="#8a91a8" stroke="#0b0a12" stroke-width="1.5"/>
 <path class="ind" d="M60 13.5 L60 28" stroke="#22d3ee" stroke-width="1.6"/>
 <path d="M31 46 L60 42 L89 46 L87 64 L60 69 L33 64Z" fill="#06070c" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M35 48 L58 45 L50 50 L36 52Z" fill="#fff" opacity=".09"/>
 <g class="blink tb"><g class="look gc"><path d="M39 54 L54 52 L54 57 L40 58.5Z" fill="#5eeaff"/><path d="M81 54 L66 52 L66 57 L80 58.5Z" fill="#5eeaff"/></g></g>
 <rect class="scan" x="58" y="47" width="4" height="19" fill="#22d3ee" opacity=".5"/>
 <path d="M33 64 L40 86 M87 64 L80 86" stroke="#23262f" stroke-width="2"/>
 <path d="M47 76 L73 76 L70 93 L50 93Z" fill="#14161d" stroke="#0b0a12" stroke-width="2"/>
 <g class="eq" fill="#3b3f52"><rect x="51" y="79" width="2" height="11"/><rect x="55" y="79" width="2" height="11"/><rect x="59" y="79" width="2" height="11"/><rect x="63" y="79" width="2" height="11"/><rect x="67" y="79" width="2" height="11"/></g>
</g>`,

    wolf: `<g class="breathe" stroke-linejoin="round">
 <path d="M40 96 L60 104 L80 96 L74 118 L60 112 L46 118Z" fill="#3a4060" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M30 6 L50 32 L32 44Z" fill="#7e88a6" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M33.5 15 L45 32 L35 39Z" fill="#232840"/>
 <path d="M90 6 L70 32 L88 44Z" fill="#5d6687" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M86.5 15 L75 32 L85 39Z" fill="#1a1e31"/>
 <path d="M34 40 L48 30 L60 34 L72 30 L86 40 L94 58 L106 66 L91 70 L98 80 L81 78 L74 92 L60 104 L46 92 L39 78 L22 80 L29 70 L14 66 L26 58Z" fill="#7e88a6" stroke="#0b0a12" stroke-width="3"/>
 <path d="M60 34 L72 30 L86 40 L94 58 L106 66 L91 70 L98 80 L81 78 L74 92 L60 104Z" fill="#2a3050" opacity=".5"/>
 <path d="M26 58 L36 62 L34 72 L18 66Z" fill="#c5cbe0" opacity=".55"/>
 <path d="M38 42 L48 33 L52 38Z" fill="#c5cbe0" opacity=".7"/>
 <path d="M46 32 L60 50 L74 32 L60 40Z" fill="#232840"/>
 <path d="M50 62 L60 57 L70 62 L74 82 L60 98 L46 82Z" fill="#e2e6f0" stroke="#0b0a12" stroke-width="2"/>
 <path d="M60 57 L70 62 L74 82 L60 98Z" fill="#aab2cb"/>
 <path d="M35 51 L54 56 M85 51 L66 56" stroke="#15182a" stroke-width="3.2" stroke-linecap="round"/>
 <g class="blink tb"><g class="look gc"><path d="M40 57 L54 60 L52 64 L42 62Z" fill="#5eeaff"/><path d="M80 57 L66 60 L68 64 L78 62Z" fill="#5eeaff"/></g></g>
 <path d="M53.5 76 L66.5 76 L64.5 82 L60 84.5 L55.5 82Z" fill="#0b0a12"/>
 <path d="M56 77.5 L60 77.5" stroke="#6b7190" stroke-width="1.2" stroke-linecap="round"/>
 <path class="talk" d="M51 88 L60 91 L69 88 L66 93 L60 95 L54 93Z" fill="#0b0a12"/>
 <path d="M54 90 L55.5 93.5 L57 90.6Z M66 90 L64.5 93.5 L63 90.6Z" fill="#f2f2f2"/>
</g>`,

    lich: `<defs>
 <linearGradient id="li-g{u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6c06a"/><stop offset="1" stop-color="#6b4a14"/></linearGradient>
</defs><g class="breathe" stroke-linejoin="round">
 <path d="M18 120 L30 90 L60 100 L90 90 L102 120Z" fill="#1c1630" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M30 90 L44 98 L38 120 L22 120Z" fill="#2a2148"/>
 <path d="M40 76 L80 76 L77 91 L60 98 L43 91Z" class="jaw" fill="#d9d1bb" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M32 40 L88 40 L89 58 L84 68 L76 76 L44 76 L36 68 L31 58Z" fill="#e8e1cc" stroke="#0b0a12" stroke-width="3"/>
 <path d="M60 40 L88 40 L89 58 L84 68 L76 76 L60 76Z" fill="#7d735e" opacity=".4"/>
 <path d="M35 44 L48 44 L36 54Z" fill="#fff" opacity=".6"/>
 <path d="M38 47 L54 49 L52 62 L40 60Z" fill="#0b0a12"/><path d="M82 47 L66 49 L68 62 L80 60Z" fill="#0b0a12"/>
 <g class="look gv flick"><path d="M46 51 L49 55 L46 59 L43 55Z" fill="#c4b5fd"/><path d="M74 51 L77 55 L74 59 L71 55Z" fill="#c4b5fd"/></g>
 <path d="M57 63 L63 63 L60 70Z" fill="#0b0a12"/>
 <path d="M81 43 L77 49 L80 53 L78 57" stroke="#3a3326" stroke-width="1.3" fill="none"/>
 <path d="M36 64 L44 66 M84 64 L76 66" stroke="#9c927a" stroke-width="1.5"/>
 <path d="M44 72 L76 72 L75 78 L45 78Z" fill="#f1ebda" stroke="#0b0a12" stroke-width="1.8"/>
 <path d="M49 72 L49 78 M53.5 72 L53.5 78 M58 72 L58 78 M62.5 72 L62.5 78 M67 72 L67 78 M71.5 72 L71.5 78" stroke="#0b0a12" stroke-width="1.2"/>
 <path d="M30 34 L35 12 L43 27 L50 6 L56 25 L60 0 L64 25 L70 6 L77 27 L85 12 L90 34Z" fill="url(#li-g{u})" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M28 32 L92 32 L90 41 L30 41Z" fill="#5a3f12" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M30 34 L90 34" stroke="#e6c06a" stroke-width="1.2" opacity=".7"/>
 <path class="ind gv" d="M60 16 L65 23 L60 30 L55 23Z" fill="#a78bfa" stroke="#0b0a12" stroke-width="1.6"/>
 <g fill="#22d3ee" class="ind"><circle cx="42" cy="36.5" r="1.5"/><circle cx="78" cy="36.5" r="1.5"/></g>
</g>`,

    slime: `<defs>
 <linearGradient id="ds-b{u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fa89c"/><stop offset=".6" stop-color="#0d5257"/><stop offset="1" stop-color="#062226"/></linearGradient>
 <clipPath id="ds-c{u}"><path d="M16 100 L22 74 L38 57 L60 51 L82 57 L98 74 L104 100 L92 104 L87 113 L81 104 L60 106 L44 104 L38 115 L32 104Z"/></clipPath>
</defs><g class="breathe" stroke-linejoin="round">
 <ellipse cx="60" cy="112" rx="40" ry="4" fill="#22d3ee" opacity=".12"/>
 <path d="M16 100 L22 74 L38 57 L60 51 L82 57 L98 74 L104 100 L92 104 L87 113 L81 104 L60 106 L44 104 L38 115 L32 104Z" fill="url(#ds-b{u})"/>
 <g clip-path="url(#ds-c{u})">
  <path d="M60 51 L82 57 L98 74 L104 100 L60 110Z" fill="#000" opacity=".25"/>
  <circle class="spin" cx="60" cy="88" r="13" fill="none" stroke="#22d3ee" stroke-width="1" stroke-dasharray="2 4" opacity=".55"/>
  <g class="core"><path class="ind gc" d="M60 78 L68 88 L60 98 L52 88Z" fill="#5eeaff"/><path d="M60 81 L64 88 L60 88Z" fill="#e0fbff"/></g>
  <path d="M25 80 L35 65 L46 59 L33 72Z" fill="#fff" opacity=".35"/>
  <g fill="#7ef3ff"><circle class="ember" cx="34" cy="98" r="1.4"/><circle class="ember" cx="86" cy="96" r="1.2"/><circle class="ember" cx="74" cy="102" r="1"/></g>
 </g>
 <path d="M16 100 L22 74 L38 57 L60 51 L82 57 L98 74 L104 100 L92 104 L87 113 L81 104 L60 106 L44 104 L38 115 L32 104Z" fill="none" stroke="#0b0a12" stroke-width="3"/>
 <path d="M38 42 L18 30 L11 9 L28 25 L44 34Z" fill="#cbbd9a" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M28 25 L44 34 L38 42 L22 32Z" fill="#8f8466"/>
 <path d="M82 42 L102 30 L109 9 L92 25 L76 34Z" fill="#b3a684" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M92 25 L76 34 L82 42 L98 32Z" fill="#6e664e"/>
 <path d="M33 58 L38 37 L60 27 L82 37 L87 58Z" fill="#5a6178" stroke="#0b0a12" stroke-width="2.5"/>
 <path d="M38 37 L60 27 L56 40 L36 48Z" fill="#8a91a8"/>
 <path d="M60 27 L82 37 L87 58 L60 58Z" fill="#000" opacity=".22"/>
 <path d="M29 55 L91 55 L89 64 L31 64Z" fill="#33384a" stroke="#0b0a12" stroke-width="2.5"/>
 <g fill="#a7aec4"><circle cx="37" cy="59.5" r="1.4"/><circle cx="48" cy="59.5" r="1.4"/><circle cx="72" cy="59.5" r="1.4"/><circle cx="83" cy="59.5" r="1.4"/></g>
 <path d="M56.5 55 L63.5 55 L62.5 78 L60 81 L57.5 78Z" fill="#6b7290" stroke="#0b0a12" stroke-width="2"/>
 <path d="M58 57 L58 76" stroke="#a7aec4" stroke-width="1.2"/>
 <g class="blink tb"><g class="look gc"><path d="M41 68 L54 70 L53 73.5 L42 72Z" fill="#a5f8ff"/><path d="M79 68 L66 70 L67 73.5 L78 72Z" fill="#a5f8ff"/></g></g>
</g>`,
  };

  const ID = (id) => (ART[id] ? id : DEFAULT);
  let uid = 0;

  function svg(id) {
    return `<svg viewBox="0 0 120 120" class="mascot-svg" aria-hidden="true">${ART[ID(id)].replace(/\{u\}/g, `-${++uid}`)}</svg>`;
  }

  // Crée (ou met à jour) une mascotte dans el. state : idle | listening | thinking | transcribing | speaking | error
  function render(el, id, state) {
    id = ID(id);
    if (el.dataset.mascot !== id) {
      el.innerHTML = svg(id);
      el.dataset.mascot = id;
      el.style.setProperty("--m-glow", META[id].glow);
    }
    el.classList.add("mascot");
    for (const s of ["idle", "listening", "thinking", "transcribing", "speaking", "error"]) el.classList.toggle(s, s === (state || "idle"));
  }

  // Grille de choix du personnage (paramètres, assistant) : onPick(id) à chaque clic.
  // personas : { id: { name, title, tagline } } (settings:get) · onVoice(id, bouton) : extrait de voix.
  function picker(box, selected, onPick, { personas = {}, onVoice } = {}) {
    box.classList.add("mascot-picker");
    box.innerHTML = "";
    for (const [id, m] of Object.entries(META)) {
      const p = personas[id] || {};
      const tile = document.createElement("div");
      tile.tabIndex = 0;
      tile.className = "mp-tile" + (id === ID(selected) ? " on" : "");
      tile.style.setProperty("--tint", m.tint);
      tile.title = m.desc;
      tile.innerHTML = `<div class="mp-art"></div><div class="mp-name"></div><div class="mp-title"></div><div class="mp-tag"></div>`;
      tile.querySelector(".mp-name").textContent = p.name || m.name;
      tile.querySelector(".mp-title").textContent = p.title || "";
      tile.querySelector(".mp-tag").textContent = p.tagline || "";
      render(tile.querySelector(".mp-art"), id, id === ID(selected) ? "speaking" : "idle");
      if (onVoice) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mp-voice";
        b.textContent = "▶ Voix";
        b.onclick = (e) => {
          e.stopPropagation();
          onVoice(id, b);
        };
        tile.appendChild(b);
      }
      const pick = () => {
        picker(box, id, onPick, { personas, onVoice });
        onPick(id);
      };
      tile.onclick = pick;
      tile.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick());
      box.appendChild(tile);
    }
  }

  // Image PNG (data URL) de la mascotte, pour une icône : SVG autonome dessiné sur un canvas.
  function iconDataUrl(id, size = 64) {
    const markup = svg(id)
      .replace('class="mascot-svg"', `xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`)
      .replace(/(<svg[^>]*>)/, "$1<style>.ember,.scan{display:none}</style>");
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    });
  }

  window.Mascots = { DEFAULT, META, svg, render, picker, iconDataUrl };
})();
