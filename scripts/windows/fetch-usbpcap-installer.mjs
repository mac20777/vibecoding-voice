// Downloads the official USBPcap installer into build-assets/installers so the
// NSIS installer (build-assets/installer.nsh) can bundle it. USBPcap is a
// third-party project (driver GPLv2, USBPcapCMD BSD-2-Clause); we ship the
// unmodified official installer, see THIRD-PARTY-NOTICES.txt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USBPCAP_VERSION = "1.5.4.0";
const USBPCAP_URL =
  `https://github.com/desowin/usbpcap/releases/download/${USBPCAP_VERSION}/` +
  `USBPcapSetup-${USBPCAP_VERSION}.exe`;
const EXPECTED_BYTES = 195040;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetDir = path.join(projectRoot, "build-assets", "installers");
const targetPath = path.join(targetDir, `USBPcapSetup-${USBPCAP_VERSION}.exe`);

if (fs.existsSync(targetPath) && fs.statSync(targetPath).size === EXPECTED_BYTES) {
  console.log(`USBPcap installer already present: ${targetPath}`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
console.log(`Downloading ${USBPCAP_URL} ...`);
const response = await fetch(USBPCAP_URL);
if (!response.ok) {
  throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
}
const data = Buffer.from(await response.arrayBuffer());
if (data.length !== EXPECTED_BYTES) {
  throw new Error(`Unexpected installer size: ${data.length} (expected ${EXPECTED_BYTES})`);
}
fs.writeFileSync(targetPath, data);
console.log(`Saved ${data.length} bytes to ${targetPath}`);
