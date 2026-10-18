// Fournisseur « Claude via abonnement » : pilote Claude Code installé localement en mode
// non interactif (claude -p, stream-json), comme le backend claude-cli d'OpenClaw.
// Un seul process reste ouvert par conversation pour éviter le coût de démarrage.
const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const { getBins } = require("../setup/detect");

class ClaudeCli {
  constructor(workDir) {
    this.workDir = workDir;
    this.proc = null;
    this.signature = null;
    this.turn = null; // { resolve, reject, onDelta, text }
  }

  stop() {
    if (this.proc) {
      this.proc.removeAllListeners();
      this.proc.kill();
    }
    this.proc = null;
    if (this.turn) this.turn.reject(new Error("Réponse interrompue."));
    this.turn = null;
  }

  start(bin, { model, system, webSearch }) {
    fs.mkdirSync(this.workDir, { recursive: true });

    const args = [
      ...bin.prefixArgs,
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--system-prompt", system,
      "--setting-sources", "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--tools", webSearch ? "WebSearch" : "",
    ];
    if (webSearch) args.push("--allowedTools", "WebSearch");
    if (model) args.push("--model", model);

    const proc = spawn(bin.command, args, {
      cwd: this.workDir,
      env: { ...process.env, ...bin.env },
      windowsHide: true,
    });
    this.proc = proc;

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    proc.on("exit", (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.signature = null;
      if (this.turn) {
        this.turn.reject(new Error(`Claude Code s'est arrêté (code ${code}). ${stderr.trim()}`));
        this.turn = null;
      }
    });
    proc.on("error", (err) => this.turn?.reject(err));

    readline.createInterface({ input: proc.stdout }).on("line", (line) => this.onLine(line));
  }

  onLine(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const turn = this.turn;
    if (!turn) return;

    if (ev.type === "stream_event") {
      const e = ev.event;
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
        turn.text += e.delta.text;
        turn.onDelta(e.delta.text);
      } else if (e?.type === "message_start" && turn.text) {
        // Nouveau message après une recherche web : on sépare les blocs de texte.
        turn.text += " ";
      }
    } else if (ev.type === "result") {
      this.turn = null;
      if (ev.is_error) {
        const msg = String(ev.result || ev.subtype || "erreur inconnue");
        if (/OAuth|authenticat|401|log ?in/i.test(msg)) {
          turn.reject(new Error("Claude Code n'est pas connecté (session expirée). Reconnecte-toi depuis l'assistant de configuration."));
        } else {
          turn.reject(new Error("Claude Code : " + msg));
        }
      } else {
        turn.resolve((turn.text || ev.result || "").trim());
      }
    }
  }

  // Le contexte de conversation est conservé par le process : history est ignoré ici.
  async chat({ settings, system, question, imageJpegB64, onDelta }) {
    const signature = JSON.stringify([settings.claudeCliModel, system, settings.webSearch]);
    if (this.turn || (this.proc && this.signature !== signature)) this.stop();
    if (!this.proc) {
      const { claude: bin } = await getBins();
      if (!bin) throw new Error("Claude Code est introuvable. Relance l'assistant de configuration.");
      this.start(bin, { model: settings.claudeCliModel, system, webSearch: settings.webSearch });
      this.signature = signature;
    }

    const content = [];
    if (imageJpegB64) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageJpegB64 } });
    }
    content.push({ type: "text", text: question });

    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject, onDelta, text: "" };
      this.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
    });
  }

  reset() {
    this.stop();
  }
}

module.exports = { ClaudeCli };
