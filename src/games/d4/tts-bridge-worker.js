// Récepteur du « lecteur d'écran » de Diablo IV, dans un thread dédié.
//
// Diablo IV peut envoyer le texte de chaque infobulle survolée à un lecteur d'écran tiers
// (Options > Accessibilité). La DLL saapi64.dll de D4LF (open source, MIT), placée dans le
// dossier du jeu, transmet ce texte au tube nommé \\.\pipe\d4lf au lieu de le lire à voix
// haute. Ce thread crée ce tube en mode « message » : chaque ligne envoyée par le jeu arrive
// séparément. Rien n'est injecté dans le jeu et aucune mémoire n'est lue.
const { parentPort } = require("worker_threads");
const koffi = require("koffi");

const kernel32 = koffi.load("kernel32.dll");
const CreateNamedPipeW = kernel32.func("void* __stdcall CreateNamedPipeW(str16 name, uint32 openMode, uint32 pipeMode, uint32 maxInstances, uint32 outSize, uint32 inSize, uint32 timeout, void* security)");
const ConnectNamedPipe = kernel32.func("bool __stdcall ConnectNamedPipe(void* pipe, void* overlapped)");
const ReadFile = kernel32.func("bool __stdcall ReadFile(void* file, _Out_ uint8_t* buffer, uint32 size, _Out_ uint32* read, void* overlapped)");
const DisconnectNamedPipe = kernel32.func("bool __stdcall DisconnectNamedPipe(void* pipe)");
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(void* handle)");
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");

const PIPE_ACCESS_INBOUND = 0x1;
const PIPE_TYPE_MESSAGE = 0x4;
const PIPE_READMODE_MESSAGE = 0x2;
const PIPE_WAIT = 0;
const ERROR_PIPE_CONNECTED = 535;
const ERROR_MORE_DATA = 234;
const ERROR_PIPE_BUSY = 231;
const INVALID_HANDLE = -1n;

const name = "\\\\.\\pipe\\d4lf";
const buffer = Buffer.alloc(65536);
const RETRY_MS = 3000;

// Pause bloquante (ce thread ne fait que servir le tube)
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function serve() {
  for (;;) {
    const pipe = CreateNamedPipeW(name, PIPE_ACCESS_INBOUND, PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT, 1, 0, 65536, 0, null);
    if (!pipe || koffi.address(pipe) === BigInt.asUintN(64, INVALID_HANDLE)) {
      // Tube encore tenu (D4LF, ou instance précédente de l'app qui se ferme) : on réessaie
      const err = GetLastError();
      parentPort.postMessage({ type: "error", error: err === ERROR_PIPE_BUSY ? "busy" : `CreateNamedPipe ${err}` });
      sleep(RETRY_MS);
      continue;
    }
    parentPort.postMessage({ type: "listening" });
    if (!ConnectNamedPipe(pipe, null) && GetLastError() !== ERROR_PIPE_CONNECTED) {
      CloseHandle(pipe);
      continue;
    }
    parentPort.postMessage({ type: "connected" });

    let pending = [];
    for (;;) {
      const read = [0];
      const ok = ReadFile(pipe, buffer, buffer.length, read, null);
      if (!ok && GetLastError() !== ERROR_MORE_DATA) break; // le jeu s'est fermé
      pending.push(Buffer.from(buffer.subarray(0, read[0])));
      if (!ok) continue; // message plus long que le tampon : la suite arrive
      const text = Buffer.concat(pending).toString("utf8").replace(/\0/g, "");
      pending = [];
      if (text === "DISCONNECTED") break;
      if (text && text !== "CONNECTED") parentPort.postMessage({ type: "line", text, at: Date.now() });
    }
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
    parentPort.postMessage({ type: "disconnected" });
  }
}

serve();
