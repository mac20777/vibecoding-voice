// One-off screenshot helper: renders the redesign prototype with the project's
// own Electron and captures each page to design/screenshots/.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const pages = ["home", "settings", "transcripts", "logs"];
const outDir = path.join(__dirname, "screenshots");

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    backgroundColor: "#0c0e12",
    webPreferences: { offscreen: true }
  });
  await win.loadFile(path.join(__dirname, "redesign-prototype.html"));
  await new Promise((r) => setTimeout(r, 2500)); // webfonts settle

  for (const page of pages) {
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-page="${page}"]').click()`
    );
    await new Promise((r) => setTimeout(r, 400));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `redesign-${page}.png`), image.toPNG());
    console.log("captured", page);
  }

  // Settings → remote tab
  await win.webContents.executeJavaScript(`
    document.querySelector('[data-page="settings"]').click();
    document.querySelector('[data-tab="remote"]').click();
  `);
  await new Promise((r) => setTimeout(r, 400));
  const remoteImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "redesign-remote.png"), remoteImage.toPNG());
  console.log("captured remote");

  // English variant of home
  await win.webContents.executeJavaScript(`
    document.getElementById("lang-toggle").click();
    document.querySelector('[data-page="home"]').click();
  `);
  await new Promise((r) => setTimeout(r, 400));
  const enImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "redesign-home-en.png"), enImage.toPNG());
  console.log("captured home-en");

  win.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
