// Fournisseur « OpenAI via abonnement ChatGPT » : pilote Codex CLI connecté avec ChatGPT
// (codex login). Chaque question lance un `codex exec` éphémère ; l'historique est
// réinjecté dans le prompt, et nos instructions courtes remplacent celles d'agent de code
// (≈ 4 s au lieu de ≈ 7 s par réponse).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { getBins } = require("../setup/detect");

class CodexCli {
  constructor(workDir) {
    this.workDir = workDir;
    this.proc = null;
  }

  stop() {
    if (this.proc) {
      this.proc.removeAllListeners();
      this.proc.kill();
    }
    this.proc = null;
  }

  reset() {
    this.stop();
  }

  async chat({ settings, system, history, question, imageJpegB64, onDelta }) {
    this.stop();
    const { codex: bin } = await getBins();
    if (!bin) throw new Error("Codex est introuvable. Relance l'assistant de configuration.");
    fs.mkdirSync(this.workDir, { recursive: true });

    const instructions = path.join(this.workDir, "instructions.md");
    fs.writeFileSync(instructions, system);
    const toml = (s) => JSON.stringify(s.replace(/\\/g, "/"));

    const args = [
      ...bin.prefixArgs,
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s", "read-only",
      "-C", this.workDir,
      "-c", `model_instructions_file=${toml(instructions)}`,
      "-c", `model_reasoning_effort="${settings.codexEffort || "low"}"`,
      "-c", `web_search="${settings.webSearch ? "live" : "disabled"}"`,
    ];
    if (settings.codexModel) args.push("-m", settings.codexModel);
    if (imageJpegB64) {
      const img = path.join(this.workDir, "capture.jpg");
      fs.writeFileSync(img, Buffer.from(imageJpegB64, "base64"));
      args.push("-i", img);
    }
    args.push("-");

    let prompt = "";
    if (history.length) {
      prompt += "Conversation précédente :\n";
      for (const m of history) prompt += `${m.role === "user" ? "Joueur" : "Toi"} : ${m.text}\n`;
      prompt += "\nNouvelle question du joueur";
      prompt += imageJpegB64 ? " (capture d'écran actuelle jointe) :\n" : " :\n";
    } else if (imageJpegB64) {
      prompt += "Question du joueur (capture d'écran actuelle jointe) :\n";
    }
    prompt += question;

    const proc = spawn(bin.command, args, { cwd: this.workDir, env: { ...process.env, ...bin.env }, windowsHide: true });
    this.proc = proc;
    proc.stdin.end(prompt);

    return new Promise((resolve, reject) => {
      let text = "";
      let error = null;
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
      readline.createInterface({ input: proc.stdout }).on("line", (line) => {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === "item.completed" && ev.item?.type === "agent_message") {
          const part = (text ? "\n" : "") + ev.item.text;
          text += part;
          onDelta(part);
        } else if (ev.type === "error" || ev.type === "turn.failed") {
          error = ev.message || ev.error?.message || "erreur inconnue";
        }
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (this.proc === proc) this.proc = null;
        if (text) return resolve(text.trim());
        const msg = error || stderr.trim() || `code ${code}`;
        if (/login|auth|401|unauthorized/i.test(msg)) {
          reject(new Error("Codex n'est pas connecté. Reconnecte-toi depuis l'assistant de configuration."));
        } else {
          reject(new Error("Codex : " + msg));
        }
      });
    });
  }
}

module.exports = { CodexCli };
