import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UsbPcapAttLineParser } from "../src/usbpcap-att-parser.mjs";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PCAP_PATH = path.join(FIXTURE_DIR, "xiaomi-voice.pcap");
const EXPECTED_LINES_PATH = path.join(FIXTURE_DIR, "xiaomi-voice-tshark-lines.txt");

function loadExpectedLines() {
  return fs.readFileSync(EXPECTED_LINES_PATH, "utf8").trim().split(/\r?\n/);
}

function parseInChunks(pcap, chunkSize) {
  const parser = new UsbPcapAttLineParser();
  const lines = [];
  for (let offset = 0; offset < pcap.length; offset += chunkSize) {
    lines.push(...parser.push(pcap.subarray(offset, offset + chunkSize)));
  }
  lines.push(...parser.end());
  return lines;
}

function buildPcap(records) {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4, 0); // little-endian magic
  header.writeUInt16LE(2, 4);
  header.writeUInt16LE(4, 6);
  header.writeUInt32LE(0xffff, 16); // snaplen
  header.writeUInt32LE(249, 20); // LINKTYPE_USBPCAP
  return Buffer.concat([header, ...records]);
}

function usbpcapRecord(payload, { transfer = 3, info = 1 } = {}) {
  const headerLen = 27;
  const record = Buffer.alloc(16 + headerLen + payload.length);
  record.writeUInt32LE(headerLen + payload.length, 8); // incl_len
  record.writeUInt32LE(headerLen + payload.length, 12); // orig_len
  record.writeUInt16LE(headerLen, 16);
  record[16 + 16] = info; // info: bit0 = IN
  record[16 + 21] = 0x82; // endpoint
  record[16 + 22] = transfer; // bulk
  record.writeUInt32LE(payload.length, 16 + 23); // dataLength
  payload.copy(record, 16 + headerLen);
  return record;
}

function aclFragment(l2capChunk, pbFlag, connectionHandle = 0x0041) {
  const acl = Buffer.alloc(4 + l2capChunk.length);
  acl.writeUInt16LE(connectionHandle | (pbFlag << 12), 0);
  acl.writeUInt16LE(l2capChunk.length, 2);
  l2capChunk.copy(acl, 4);
  return acl;
}

function attNotificationL2cap(handle, value) {
  const l2cap = Buffer.alloc(4 + 3 + value.length);
  l2cap.writeUInt16LE(3 + value.length, 0); // SDU length = opcode + handle + value
  l2cap.writeUInt16LE(0x0004, 2); // ATT CID
  l2cap[4] = 0x1b; // Handle Value Notification
  l2cap.writeUInt16LE(handle, 5);
  value.copy(l2cap, 7);
  return l2cap;
}

test("fixture parsed in a single push matches tshark output line by line", () => {
  const pcap = fs.readFileSync(PCAP_PATH);
  const parser = new UsbPcapAttLineParser();
  const lines = [...parser.push(pcap), ...parser.end()];
  assert.deepEqual(lines, loadExpectedLines());
});

test("fixture parsed in chunks of 1, 7, 1024 and 65536 bytes matches tshark output", () => {
  const pcap = fs.readFileSync(PCAP_PATH);
  const expected = loadExpectedLines();
  for (const chunkSize of [1, 7, 1024, 64 * 1024]) {
    assert.deepEqual(parseInChunks(pcap, chunkSize), expected, `chunk size ${chunkSize}`);
  }
});

test("rejects a bad pcap magic", () => {
  const parser = new UsbPcapAttLineParser();
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0x0a0d0d0a, 0);
  header.writeUInt32LE(249, 20);
  assert.throws(() => parser.push(header), /bad pcap magic/);
});

test("rejects a non-USBPCAP linktype", () => {
  const parser = new UsbPcapAttLineParser();
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4, 0);
  header.writeUInt16LE(2, 4);
  header.writeUInt16LE(4, 6);
  header.writeUInt32LE(0xffff, 16);
  header.writeUInt32LE(1, 20); // LINKTYPE_ETHERNET
  assert.throws(() => parser.push(header), /unsupported linktype 1/);
});

test("rejects a truncated global header on end", () => {
  const parser = new UsbPcapAttLineParser();
  parser.push(Buffer.from([0xd4, 0xc3, 0xb2, 0xa1, 0x02]));
  assert.throws(() => parser.end(), /truncated pcap global header/);
});

test("parses a synthetic single-fragment ATT notification", () => {
  const pcap = buildPcap([usbpcapRecord(aclFragment(attNotificationL2cap(0x002a, Buffer.from("beef", "hex")), 0x02))]);
  assert.deepEqual(parseInChunks(pcap, 1024), ["0x002a|beef"]);
});

test("reassembles an L2CAP PDU split across HCI ACL fragments", () => {
  const l2cap = attNotificationL2cap(0x0029, Buffer.alloc(60, 0x5a));
  const pcap = buildPcap([
    usbpcapRecord(aclFragment(l2cap.subarray(0, 27), 0x02)),
    usbpcapRecord(aclFragment(l2cap.subarray(27, 54), 0x01)),
    usbpcapRecord(aclFragment(l2cap.subarray(54), 0x01))
  ]);
  assert.deepEqual(parseInChunks(pcap, 8), [`0x0029|${"5a".repeat(60)}`]);
});

test("skips a corrupted packet and keeps parsing the stream", () => {
  const good = usbpcapRecord(aclFragment(attNotificationL2cap(0x0025, Buffer.alloc(20, 0x00)), 0x02));
  const garbage = usbpcapRecord(Buffer.from("not a valid hci acl packet!!", "ascii"));
  const pcap = buildPcap([garbage, good, garbage]);
  assert.deepEqual(parseInChunks(pcap, 3), [`0x0025|${"00".repeat(20)}`]);
});
