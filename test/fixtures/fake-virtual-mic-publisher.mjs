// Fake vibecoding-virtual-mic-publisher for tests: answers --list with a
// fabricated VB-CABLE pair, then speaks the framed stdin protocol and records
// every message as a JSON line in FAKE_PUBLISHER_LOG.
import fs from "node:fs";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_PUBLISHER_LOG || "";

// `node --test` treats every JavaScript file below test/ as a test module.
// Exit when the fixture is discovered directly; real publisher launches
// always include either --list, --restore-route, or the endpoint arguments.
if (args.length === 0) {
  process.exit(0);
}

function record(entry) {
  if (logPath) {
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  }
}

if (args[0] === "--list") {
  console.log(JSON.stringify({ type: "endpoint", flow: "render", name: "CABLE Input (VB-Audio Virtual Cable)" }));
  console.log(JSON.stringify({ type: "endpoint", flow: "capture", name: "CABLE Output (VB-Audio Virtual Cable)" }));
  process.exit(0);
}

if (args[0] === "--restore-route") {
  record({ type: "restore-route", path: args[1] || "" });
  process.exit(0);
}

record({ type: "spawn", args });
process.stdout.write(
  JSON.stringify({ type: "ready", endpoint: args[1] || "", sampleRate: 16000, channels: 1, bitsPerSample: 16 }) + "\n"
);

const HEADER_BYTES = 12;
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= HEADER_BYTES) {
    const type = buffer.readUInt16LE(4);
    const payloadBytes = buffer.readUInt32LE(8);
    if (buffer.length < HEADER_BYTES + payloadBytes) {
      break;
    }
    const payload = buffer.subarray(HEADER_BYTES, HEADER_BYTES + payloadBytes);
    record({ type, payloadHex: payload.toString("hex") });
    if (type === 6) {
      process.stdout.write(JSON.stringify({ type: "route_prepared" }) + "\n");
    } else if (type === 1) {
      process.stdout.write(JSON.stringify({ type: "shortcut_pressed", shortcut: "Ctrl+Win+Shift" }) + "\n");
    } else if (type === 3 || type === 4) {
      process.stdout.write(JSON.stringify({ type: "session_idle", reason: type === 3 ? "drain" : "cancel" }) + "\n");
    }
    buffer = buffer.subarray(HEADER_BYTES + payloadBytes);
  }
});
process.stdin.on("end", () => process.exit(0));
