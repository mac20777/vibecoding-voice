import test from "node:test";
import assert from "node:assert/strict";

import { pickLocalAddressForRemote } from "../src/discovery-server.mjs";

test("pickLocalAddressForRemote prefers the interface on the same subnet", () => {
  const networkInterfaces = {
    Ethernet: [
      {
        family: "IPv4",
        internal: false,
        address: "192.168.3.132",
        netmask: "255.255.255.0"
      }
    ],
    WiFi: [
      {
        family: "IPv4",
        internal: false,
        address: "10.0.0.5",
        netmask: "255.255.255.0"
      }
    ]
  };

  assert.equal(pickLocalAddressForRemote("192.168.3.128", networkInterfaces), "192.168.3.132");
});

test("pickLocalAddressForRemote falls back to the first external IPv4 address", () => {
  const networkInterfaces = {
    Ethernet: [
      {
        family: "IPv4",
        internal: false,
        address: "192.168.3.132",
        netmask: "255.255.255.0"
      }
    ]
  };

  assert.equal(pickLocalAddressForRemote("172.16.0.10", networkInterfaces), "192.168.3.132");
});
