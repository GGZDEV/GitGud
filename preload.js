const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
});
