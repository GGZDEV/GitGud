// Détection de ce qui est déjà installé, pour ne jamais installer de doublon :
// - Codex : app Codex (OpenAI), installation npm, ou tout `codex` du PATH
// - Claude Code : installation native, npm, ou la copie embarquée par Claude Desktop
// On garde la version la plus récente trouvée.
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const IS_WIN = process.platform === "win32";

function run(command, args, { env = {}, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { env: { ...process.env, ...env }, timeout, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err?.code ?? 0, out: `${stdout || ""}${stderr || ""}` })
    );
  });
}

// Sous-dossiers à un seul niveau : dir/*/file, ou dir/*/*/file si depth = 2.
function globDirs(base, depth, file) {
  const results = [];
  const walk = (dir, level) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      if (level === depth) {
        const f = path.join(sub, file);
        if (fs.existsSync(f)) results.push(f);
      } else {
        walk(sub, level + 1);
      }
    }
  };
  walk(base, 1);
  return results;
}

// Résout les entrées du PATH : .exe direct, ou shim npm (.cmd) → script JS lancé avec le Node d'Electron.
async function fromPath(name) {
  const r = await run(IS_WIN ? "where.exe" : "which", [name]);
  if (!r.ok) return [];
  const found = [];
  for (const line of r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const lower = line.toLowerCase();
    if (!IS_WIN || lower.endsWith(".exe")) {
      found.push({ command: line, prefixArgs: [], env: {}, source: "PATH" });
    } else if (lower.endsWith(".cmd")) {
      const text = fs.readFileSync(line, "utf8");
      const js = text.match(/"%dp0%\\([^"]+\.(?:js|mjs|cjs))"/i);
      const exe = text.match(/"%dp0%\\([^"]+\.exe)"/i);
      if (js) {
        found.push({
          command: process.execPath,
          prefixArgs: [path.join(path.dirname(line), js[1])],
          env: { ELECTRON_RUN_AS_NODE: "1" },
          source: "npm",
        });
      } else if (exe) {
        found.push({ command: path.join(path.dirname(line), exe[1]), prefixArgs: [], env: {}, source: "npm" });
      }
    }
  }
  return found;
}

function parseVersion(text) {
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { text: m[0], parts: m.slice(1).map(Number) } : null;
}

function newer(a, b) {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  return false;
}

async function withVersions(candidates) {
  const seen = new Set();
  const unique = candidates.filter((c) => {
    const key = (c.prefixArgs[0] || c.command).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const checked = await Promise.all(
    unique.map(async (c) => {
      const r = await run(c.command, [...c.prefixArgs, "--version"], { env: c.env });
      const version = r.ok ? parseVersion(r.out) : null;
      return version ? { ...c, version } : null;
    })
  );
  return checked.filter(Boolean);
}

function pickNewest(list) {
  return list.reduce((best, c) => (!best || newer(c.version, best.version) ? c : best), null);
}

async function findCodex() {
  const candidates = [
    ...globDirs(path.join(LOCALAPPDATA, "OpenAI", "Codex", "bin"), 1, "codex.exe").map((command) => ({
      command,
      prefixArgs: [],
      env: {},
      source: "app Codex",
    })),
    ...(await fromPath("codex")),
  ];
  const all = await withVersions(candidates);
  return { best: pickNewest(all), all };
}

async function findClaude() {
  const candidates = [
    ...(await fromPath("claude")),
    { command: path.join(os.homedir(), ".local", "bin", IS_WIN ? "claude.exe" : "claude"), prefixArgs: [], env: {}, source: "installation native" },
    ...globDirs(path.join(LOCALAPPDATA, "Claude-Data"), 4, "claude.exe")
      .filter((p) => p.includes(`${path.sep}claude-code${path.sep}`))
      .map((command) => ({ command, prefixArgs: [], env: {}, source: "Claude Desktop" })),
  ].filter((c) => c.prefixArgs.length || fs.existsSync(c.command));
  const all = await withVersions(candidates);
  return { best: pickNewest(all), all };
}

// Statut de connexion déclaré par l'outil. Attention : Claude Code peut se dire connecté
// avec une session expirée ; seul un vrai test (setup:test) le confirme.
async function codexLogin(bin) {
  const r = await run(bin.command, [...bin.prefixArgs, "login", "status"], { env: bin.env });
  if (/logged in/i.test(r.out) && !/not logged in/i.test(r.out)) {
    return { state: "ok", detail: r.out.trim().split(/\r?\n/)[0] };
  }
  return { state: "missing", detail: "Non connecté" };
}

async function claudeLogin(bin) {
  // Sortie JSON (versions récentes) : { loggedIn, authMethod, ... }
  const r = await run(bin.command, [...bin.prefixArgs, "auth", "status"], { env: bin.env });
  try {
    const s = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1));
    if (s.loggedIn) return { state: "claimed", detail: s.subscriptionType ? `Claude ${s.subscriptionType}` : s.authMethod || "connecté" };
  } catch {}
  const text = (await run(bin.command, [...bin.prefixArgs, "auth", "status", "--text"], { env: bin.env })).out;
  if (/expired/i.test(text)) return { state: "missing", detail: "Session expirée" };
  if (/not (logged|signed) in/i.test(text)) return { state: "missing", detail: "Non connecté" };
  const method = text.match(/Login method:\s*(.+)/i);
  if (method) return { state: "claimed", detail: method[1].trim() };
  return { state: "unknown", detail: "Statut inconnu (version ancienne)" };
}

async function hasNpm() {
  return (await fromPath("npm")).length > 0 || (await run(IS_WIN ? "where.exe" : "which", ["npm"])).ok;
}

let cached = null;

// Pour les fournisseurs : chemin du binaire retenu (mis en cache le temps de la session).
async function getBins(force = false) {
  if (!cached || force) {
    const [codex, claude] = await Promise.all([findCodex(), findClaude()]);
    cached = { codex: codex.best, claude: claude.best, codexAll: codex.all, claudeAll: claude.all };
  }
  return cached;
}

async function detectAll() {
  const bins = await getBins(true);
  const [codexAuth, claudeAuth, npm] = await Promise.all([
    bins.codex ? codexLogin(bins.codex) : null,
    bins.claude ? claudeLogin(bins.claude) : null,
    hasNpm(),
  ]);
  const describe = (b) => b && { path: b.prefixArgs[0] || b.command, version: b.version.text, source: b.source };
  return {
    codex: { found: !!bins.codex, ...describe(bins.codex), others: bins.codexAll.length - (bins.codex ? 1 : 0), auth: codexAuth },
    claude: { found: !!bins.claude, ...describe(bins.claude), others: bins.claudeAll.length - (bins.claude ? 1 : 0), auth: claudeAuth },
    npm,
  };
}

module.exports = { detectAll, getBins };
