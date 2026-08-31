const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibeOverlay", {
  cancel: (origin = "overlay_click") => ipcRenderer.send("overlay:cancel", origin),
  onEvent: (callback) => {
    if (typeof callback !== "function") {
      return;
    }
    ipcRenderer.on("overlay:event", (_event, payload) => callback(payload));
  }
});
