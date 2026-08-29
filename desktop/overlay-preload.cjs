const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibeOverlay", {
  cancel: (origin = "overlay_click") => ipcRenderer.send("overlay:cancel", origin),
  wechatCaptureReady: (sessionId) => ipcRenderer.send("overlay:wechat-capture-ready", sessionId),
  wechatCaptureResult: (payload) => ipcRenderer.send("overlay:wechat-capture-result", payload),
  onEvent: (callback) => {
    if (typeof callback !== "function") {
      return;
    }
    ipcRenderer.on("overlay:event", (_event, payload) => callback(payload));
  }
});
