const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibeOverlay", {
  onEvent: (callback) => {
    if (typeof callback !== "function") {
      return;
    }
    ipcRenderer.on("overlay:event", (_event, payload) => callback(payload));
  }
});
