// Thread dédié à la synthèse vocale Piper (phonémisation WASM + ONNX) : l'overlay et les
// raccourcis restent réactifs pendant que la voix est générée.
const { parentPort, workerData } = require("worker_threads");
const { Piper, toWav } = require("./piper");

const piper = new Piper(workerData.dirs, (p) => parentPort.postMessage({ type: "progress", ...p }));

parentPort.on("message", async (msg) => {
  try {
    if (msg.type === "has") {
      parentPort.postMessage({ id: msg.id, type: "result", value: piper.has(msg.voice) });
    } else if (msg.type === "preload") {
      await piper.load(msg.voice);
      parentPort.postMessage({ id: msg.id, type: "result", value: true });
    } else {
      const { samples, sampleRate } = await piper.synthesize(msg.text, msg.options);
      parentPort.postMessage({ id: msg.id, type: "result", value: toWav(samples, sampleRate) });
    }
  } catch (err) {
    parentPort.postMessage({ id: msg.id, type: "error", error: err.message || String(err) });
  }
});
