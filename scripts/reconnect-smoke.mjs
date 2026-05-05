#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const options = {
    port: Number(process.env.LAN_VOICE_PORT || "8765"),
    outageSec: Number(process.env.RECONNECT_OUTAGE_SEC || "45"),
    restoreSec: Number(process.env.RECONNECT_RESTORE_SEC || "30"),
    serviceExe: process.env.VIBE_SERVICE_EXE || "D:\\Program Files\\VibeCoding Voice\\VibeCoding Voice.exe",
    deviceIp: process.env.RECONNECT_DEVICE_IP || ""
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = inlineValue ?? argv[i + 1];
    const consumeNext = inlineValue === undefined;

    if (key === "--port") {
      options.port = Number(nextValue);
    } else if (key === "--outage-sec") {
      options.outageSec = Number(nextValue);
    } else if (key === "--restore-sec") {
      options.restoreSec = Number(nextValue);
    } else if (key === "--service-exe") {
      options.serviceExe = String(nextValue || "");
    } else if (key === "--device-ip") {
      options.deviceIp = String(nextValue || "");
    } else {
      continue;
    }

    if (consumeNext) {
      i++;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runPowerShell(script, { json = false } = {}) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 }
  );
  if (!json) {
    return stdout;
  }
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isLoopback(address) {
  const text = String(address || "");
  return text === "127.0.0.1" || text === "::1" || text === "::ffff:127.0.0.1";
}

async function readConnections(port) {
  const script = `
$port = ${Number(port)}
@(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess) |
  ConvertTo-Json -Depth 4
`;
  return asArray(await runPowerShell(script, { json: true }));
}

function findBoardConnection(rows, deviceIp = "") {
  return rows.find((row) => {
    if (String(row.State).toLowerCase() !== "established") {
      return false;
    }
    if (!row.RemoteAddress || row.RemoteAddress === "0.0.0.0" || isLoopback(row.RemoteAddress)) {
      return false;
    }
    return !deviceIp || row.RemoteAddress === deviceIp;
  });
}

async function stopDesktopService() {
  await runPowerShell(`
Get-Process -Name 'VibeCoding Voice' -ErrorAction SilentlyContinue |
  Stop-Process -Force
`);
}

async function startDesktopService(serviceExe) {
  if (!fs.existsSync(serviceExe)) {
    throw new Error(`service executable not found: ${serviceExe}`);
  }
  await runPowerShell(`Start-Process -FilePath ${psQuote(serviceExe)} -WindowStyle Hidden`);
}

async function waitForBoardConnection({ port, deviceIp, restoreSec }) {
  const deadline = Date.now() + restoreSec * 1000;
  while (Date.now() < deadline) {
    const rows = await readConnections(port);
    const connection = findBoardConnection(rows, deviceIp);
    if (connection) {
      return connection;
    }
    await sleep(2000);
  }
  return null;
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("reconnect smoke test currently supports Windows only");
  }

  const options = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`invalid --port: ${options.port}`);
  }
  if (!Number.isFinite(options.outageSec) || options.outageSec < 1) {
    throw new Error(`invalid --outage-sec: ${options.outageSec}`);
  }
  if (!Number.isFinite(options.restoreSec) || options.restoreSec < 1) {
    throw new Error(`invalid --restore-sec: ${options.restoreSec}`);
  }

  console.log("Reconnect smoke test");
  console.log(`  port        ${options.port}`);
  console.log(`  outage      ${options.outageSec}s`);
  console.log(`  restore     ${options.restoreSec}s`);
  console.log(`  service     ${options.serviceExe}`);
  console.log(`  device ip   ${options.deviceIp || "(any LAN client)"}`);

  const beforeRows = await readConnections(options.port);
  const beforeConnection = findBoardConnection(beforeRows, options.deviceIp);
  if (beforeConnection) {
    console.log(`  before      connected ${beforeConnection.RemoteAddress}:${beforeConnection.RemotePort}`);
  } else {
    console.log("  before      no board connection found");
  }

  console.log("  action      stopping VibeCoding Voice");
  await stopDesktopService();
  await sleep(options.outageSec * 1000);

  console.log("  action      starting VibeCoding Voice");
  await startDesktopService(options.serviceExe);

  const connection = await waitForBoardConnection(options);
  if (!connection) {
    console.error(`  result      FAILED: no board connection within ${options.restoreSec}s`);
    process.exit(1);
  }

  console.log(
    `  result      OK: ${connection.RemoteAddress}:${connection.RemotePort} -> ` +
      `${connection.LocalAddress}:${connection.LocalPort}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

