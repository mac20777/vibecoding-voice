import dgram from "node:dgram";
import os from "node:os";

import { signDiscoveryReply } from "./lan-auth.mjs";

const DISCOVERY_SERVICE = "vibecoding-voice";

function ipv4ToInt(address) {
  return address
    .split(".")
    .map((part) => Number(part))
    .reduce((value, octet) => ((value << 8) | (octet & 0xff)) >>> 0, 0);
}

function isSameSubnet(localAddress, remoteAddress, netmask) {
  try {
    const local = ipv4ToInt(localAddress);
    const remote = ipv4ToInt(remoteAddress);
    const mask = ipv4ToInt(netmask);
    return (local & mask) === (remote & mask);
  } catch {
    return false;
  }
}

export function pickLocalAddressForRemote(remoteAddress, networkInterfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const entries of Object.values(networkInterfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.address || !entry.netmask) {
        continue;
      }
      candidates.push(entry);
    }
  }

  if (candidates.length === 0) {
    return "";
  }

  const sameSubnet = candidates.find((entry) => isSameSubnet(entry.address, remoteAddress, entry.netmask));
  return (sameSubnet || candidates[0]).address;
}

function parseDiscoveryRequest(message) {
  try {
    const payload = JSON.parse(String(message || ""));
    if (payload?.type !== "discover_host") {
      return null;
    }
    if (payload?.service && payload.service !== DISCOVERY_SERVICE) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function startDiscoveryServer(config, { log = () => {} } = {}) {
  if (!config.discoveryEnabled) {
    return null;
  }

  const socket = dgram.createSocket("udp4");
  socket.on("error", (error) => {
    log("discovery error", error.message);
  });

  socket.on("message", (message, remoteInfo) => {
    const request = parseDiscoveryRequest(message);
    if (!request) {
      return;
    }

    const expectedHostId = String(request.expectedHostId || "").trim();
    if (expectedHostId && expectedHostId !== config.discoveryHostId) {
      return;
    }

    const replyAddress = pickLocalAddressForRemote(remoteInfo.address);
    if (!replyAddress) {
      return;
    }

    const payload = Buffer.from(
      JSON.stringify({
        type: "discover_reply",
        service: DISCOVERY_SERVICE,
        hostId: config.discoveryHostId,
        hostName: os.hostname(),
        wsUrl: `ws://${replyAddress}:${config.port}`,
        wsPort: config.port,
        nonce: String(request.nonce || "")
      }),
      "utf8"
    );

    const body = JSON.parse(payload.toString("utf8"));
    if (config.lanSharedSecret && body.nonce) {
      body.authSig = signDiscoveryReply(
        {
          hostId: body.hostId,
          hostName: body.hostName,
          wsUrl: body.wsUrl,
          nonce: body.nonce
        },
        config.lanSharedSecret
      );
    }
    const replyBuffer = Buffer.from(JSON.stringify(body), "utf8");

    socket.send(replyBuffer, remoteInfo.port, remoteInfo.address, (error) => {
      if (error) {
        log("discovery reply error", error.message);
        return;
      }
      log("discovery reply", {
        remote: remoteInfo.address,
        deviceId: request.deviceId || "unknown",
        wsUrl: `ws://${replyAddress}:${config.port}`
      });
    });
  });

  socket.bind(config.discoveryPort, config.bindHost, () => {
    socket.setBroadcast(true);
    log(`discovery listening on udp://${config.bindHost}:${config.discoveryPort}`);
  });

  return socket;
}
