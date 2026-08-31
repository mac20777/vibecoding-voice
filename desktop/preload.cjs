const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vibeApp", {
  getBootstrap: () => ipcRenderer.invoke("desktop:get-bootstrap"),
  startService: () => ipcRenderer.invoke("desktop:start-service"),
  stopService: () => ipcRenderer.invoke("desktop:stop-service"),
  restartService: () => ipcRenderer.invoke("desktop:restart-service"),
  saveConfig: (payload) => ipcRenderer.invoke("desktop:save-config", payload),
  setMode: (mode) => ipcRenderer.invoke("desktop:set-mode", mode),
  updateDesktopSettings: (patch) => ipcRenderer.invoke("desktop:update-desktop-settings", patch),
  fixRemoteHid: () => ipcRenderer.invoke("desktop:fix-remote-hid"),
  refreshRemoteHid: () => ipcRenderer.invoke("desktop:refresh-remote-hid"),
  getRemotePairingStatus: () => ipcRenderer.invoke("desktop:remote-pairing-status"),
  openBluetoothSettings: () => ipcRenderer.invoke("desktop:open-bluetooth-settings"),
  setTrayLanguageMode: (mode) => ipcRenderer.send("desktop:set-tray-language-mode", mode),
  pickDirectory: (currentPath) => ipcRenderer.invoke("desktop:pick-directory", currentPath),
  openConfigFolder: () => ipcRenderer.invoke("desktop:open-config-folder"),
  overlayEvent: (payload) => ipcRenderer.send("overlay:event", payload),
  ensureWechatReady: () => ipcRenderer.invoke("desktop:ensure-wechat-ready"),
  openWechatInputSettings: () => ipcRenderer.invoke("desktop:open-wechat-input-settings"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  onState: (callback) => {
    if (typeof callback !== "function") {
      return;
    }
    ipcRenderer.on("desktop:state", (_event, payload) => callback(payload));
  },
  onGlobalHotkey: (callback) => {
    if (typeof callback !== "function") {
      return;
    }
    ipcRenderer.on("desktop:global-hotkey", (_event, payload) => callback(payload));
  }
});
