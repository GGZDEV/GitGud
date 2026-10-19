// Deadlock : statistiques en direct de deadlock-api.com (API communautaire publique).
// Ajoute à la question les chiffres utiles : méta des héros, counters, objets qui gagnent,
// et l'historique de tes parties si ton identifiant Steam est renseigné.
const API = "https://api.deadlock-api.com";
const TTL = 6 * 60 * 60 * 1000; // les statistiques bougent peu : cache de 6 h
const STEAM64_BASE = 76561197960265728n;

const cache = new Map();

async function cached(key, url) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const res = await fetch(url, { headers: { "User-Agent": "GitGud" } });
  if (!res.ok) throw new Error(`deadlock-api.com : ${res.status}`);
  const data = await res.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}

const since = () => Math.floor(Date.now() / 1000) - 30 * 86400; // 30 derniers jours
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");

// Noms français (affichés) ; les noms anglais servent aussi à reconnaître les héros cités.
async function heroes() {
  const [fr, en] = await Promise.all([
    cached("heroes-fr", `${API}/v1/assets/heroes?language=french&only_active=true`),
    cached("heroes-en", `${API}/v1/assets/heroes?language=english&only_active=true`),
  ]);
  const english = new Map(en.map((h) => [h.id, h.name]));
  return new Map(fr.filter((h) => h.player_selectable !== false && !h.disabled).map((h) => [h.id, { name: h.name, en: english.get(h.id) || h.name }]));
}

async function items() {
  const list = await cached("items", `${API}/v1/assets/items/by-type/upgrade?language=french`);
  return new Map(list.filter((i) => i.shopable).map((i) => [i.id, { name: i.name, cost: i.cost, slot: i.item_slot_type }]));
}

const heroStats = () => cached("hero-stats", `${API}/v1/analytics/hero-stats?min_unix_timestamp=${since()}`);
const counterStats = () => cached("counters", `${API}/v1/analytics/hero-counter-stats?min_unix_timestamp=${since()}&same_lane_filter=true`);
const itemStats = (heroId, enemyId) =>
  cached(`items-${heroId}-${enemyId || ""}`, `${API}/v1/analytics/item-stats?hero_id=${heroId}&min_unix_timestamp=${since()}${enemyId ? `&enemy_hero_ids=${enemyId}` : ""}`);
const matchHistory = (accountId) => cached(`history-${accountId}`, `${API}/v1/players/${accountId}/match-history`);

// Identifiant de compte Deadlock : accepte l'ID Steam32 ou le SteamID64.
function accountIdOf(value) {
  const digits = String(value || "").match(/\d+/)?.[0];
  if (!digits) return null;
  const n = BigInt(digits);
  return String(n > STEAM64_BASE ? n - STEAM64_BASE : n);
}

// Héros cités dans la question, dans l'ordre ; ceux qui suivent « contre / vs / face à » sont des adversaires.
function mentionedHeroes(question, names) {
  const q = ` ${norm(question)} `;
  const found = [];
  for (const [id, h] of names) {
    const positions = [h.name, h.en].map((n) => q.indexOf(` ${norm(n).trim()} `)).filter((p) => p >= 0);
    if (positions.length) found.push({ id, name: h.name, at: Math.min(...positions) });
  }
  found.sort((a, b) => a.at - b.at);
  const vsAt = q.search(/ (contre|vs|versus|face a) /);
  return found.slice(0, 3).map((h) => ({ ...h, enemy: vsAt >= 0 && h.at > vsAt }));
}

async function context({ question, settings }) {
  const [names, stats] = await Promise.all([heroes(), heroStats()]);
  const total = stats.reduce((s, h) => s + h.matches, 0) / 12; // 12 joueurs par partie
  const rows = stats
    .filter((h) => names.has(h.hero_id) && h.matches > 500)
    .map((h) => ({ id: h.hero_id, name: names.get(h.hero_id).name, win: h.wins / h.matches, pick: h.matches / total / 12 }))
    .sort((a, b) => b.win - a.win);

  const out = ["Données Deadlock en direct (source : deadlock-api.com, parties des 30 derniers jours, tous niveaux) :"];
  out.push(`- Meilleurs taux de victoire : ${rows.slice(0, 6).map((h) => `${h.name} ${pct(h.win)}`).join(", ")}.`);
  out.push(`- Plus faibles : ${rows.slice(-4).map((h) => `${h.name} ${pct(h.win)}`).join(", ")}.`);

  const mentioned = mentionedHeroes(question, names);
  const enemy = mentioned.find((h) => h.enemy);
  const heroName = (id) => names.get(id)?.name || "?";
  if (mentioned.length) {
    const [counters, itemNames] = await Promise.all([counterStats(), items()]);
    for (const { id, name, enemy: isEnemy } of mentioned) {
      if (isEnemy && mentioned.some((h) => !h.enemy)) continue; // l'adversaire sert à filtrer les objets
      const row = rows.find((r) => r.id === id);
      if (row) out.push(`- ${name} : ${pct(row.win)} de victoires, choisi dans ${pct(row.pick)} des parties.`);

      const vs = counters
        .filter((c) => c.hero_id === id && c.matches_played >= 150 && names.has(c.enemy_hero_id))
        .map((c) => ({ name: heroName(c.enemy_hero_id), win: c.wins / c.matches_played }))
        .sort((a, b) => a.win - b.win);
      if (vs.length) {
        out.push(`- ${name} en couloir, matchups difficiles : ${vs.slice(0, 4).map((v) => `${v.name} (${pct(v.win)})`).join(", ")} ; faciles : ${vs.slice(-3).reverse().map((v) => `${v.name} (${pct(v.win)})`).join(", ")}.`);
      }

      // Objets qui gagnent, par palier de prix : les objets chers sont surtout achetés dans les
      // parties déjà gagnées, les comparer aux objets de début de partie fausserait tout.
      const vsEnemy = enemy && enemy.id !== id ? enemy : null;
      const its = (await itemStats(id, vsEnemy?.id))
        .filter((s) => itemNames.has(s.item_id) && s.matches >= (vsEnemy ? 60 : 300))
        .map((s) => ({ ...itemNames.get(s.item_id), win: s.wins / s.matches }));
      const tiers = [["début (≤ 1 250 âmes)", (c) => c <= 1250], ["milieu (1 600-3 200)", (c) => c > 1250 && c <= 3200], ["fin (6 400+)", (c) => c > 3200]];
      const parts = tiers
        .map(([label, inTier]) => {
          const best = its.filter((i) => inTier(i.cost)).sort((a, b) => b.win - a.win).slice(0, 3);
          return best.length ? `${label} : ${best.map((i) => `${i.name} ${pct(i.win)}`).join(", ")}` : "";
        })
        .filter(Boolean);
      if (parts.length) out.push(`- Objets les plus gagnants sur ${name}${vsEnemy ? ` contre ${vsEnemy.name}` : ""}, ${parts.join(" ; ")}.`);
    }
  }

  const accountId = accountIdOf(settings.deadlockAccountId);
  if (accountId && /(mes|ma|mon)\s+(dernier|derniere|parties|partie|stats|historique|games?|match)/i.test(norm(question))) {
    const history = (await matchHistory(accountId)).slice(0, 10);
    if (history.length) {
      const wins = history.filter((m) => m.match_result === m.player_team).length;
      out.push(`- Tes ${history.length} dernières parties (${wins} victoires) : ` +
        history.map((m) => `${heroName(m.hero_id)} ${m.match_result === m.player_team ? "V" : "D"} ${m.player_kills}/${m.player_deaths}/${m.player_assists}, ${Math.round(m.net_worth / 1000)}k âmes, ${Math.round(m.match_duration_s / 60)} min`).join(" ; ") + ".");
    }
  }

  return out.join("\n");
}

module.exports = {
  id: "deadlock",
  name: "Deadlock",
  match: /\bdeadlock\b/i,
  guidance:
    "Jeu : Deadlock (Valve). Appuie-toi d'abord sur les données chiffrées fournies (cite « deadlock-api.com »). " +
    "Pour les mécaniques, patchs et objets, cherche sur deadlock.wiki et les notes de patch officielles (forums.playdeadlock.com). " +
    "Termine par une ligne « Sources : » avec les liens utilisés.",
  context,
  accountIdOf,
};
