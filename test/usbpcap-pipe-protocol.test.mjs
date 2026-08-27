import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  USBPCAP_PIPE_FRAME,
  UsbPcapCaptureStreamDecoder,
  UsbPcapPipeFrameDecoder,
  encodeUsbPcapPipeFrame
} from "../src/usbpcap-pipe-protocol.mjs";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PCAP_PATH = path.join(FIXTURE_DIR, "xiaomi-voice.pcap");
const EXPECTED_LINES_PATH = path.join(FIXTURE_DIR, "xiaomi-voice-tshark-lines.txt");

function encodeMetadataFrame(type, metadata) {
  return encodeUsbPcapPipeFrame(type, Buffer.from(JSON.stringify(metadata), "utf8"));
}

test("pipe frames survive arbitrary named-pipe chunk boundaries", () => {
  const encoded = Buffer.concat([
    encodeMetadataFrame(USBPCAP_PIPE_FRAME.captureStart, { generation: 7, address: "19" }),
    encodeUsbPcapPipeFrame(USBPCAP_PIPE_FRAME.data, Buffer.from([1, 2, 3, 4])),
    encodeMetadataFrame(USBPCAP_PIPE_FRAME.captureEnd, { generation: 7, reason: "adapter-missing" })
  ]);

  for (const chunkSize of [1, 2, 7, 64 * 1024]) {
    const decoder = new UsbPcapPipeFrameDecoder();
    const frames = [];
    for (let offset = 0; offset < encoded.length; offset += chunkSize) {
      frames.push(...decoder.push(encoded.subarray(offset, offset + chunkSize)));
    }
    decoder.end();
    assert.deepEqual(frames.map((frame) => frame.type), [
      USBPCAP_PIPE_FRAME.captureStart,
      USBPCAP_PIPE_FRAME.data,
      USBPCAP_PIPE_FRAME.captureEnd
    ]);
    assert.deepEqual([...frames[1].payload], [1, 2, 3, 4]);
  }
});

test("new capture generation discards a truncated record from the old stream", () => {
  const pcap = fs.readFileSync(PCAP_PATH);
  const expectedLines = fs.readFileSync(EXPECTED_LINES_PATH, "utf8").trim().split(/\r?\n/);
  const encoded = Buffer.concat([
    encodeMetadataFrame(USBPCAP_PIPE_FRAME.captureStart, { generation: 1, address: "18" }),
    // Deliberately stop inside the first pcap record. Appending the next
    // capture without a generation reset reproduces the old stream-desync bug.
    encodeUsbPcapPipeFrame(USBPCAP_PIPE_FRAME.data, pcap.subarray(0, 40)),
    encodeMetadataFrame(USBPCAP_PIPE_FRAME.captureEnd, {
      generation: 1,
      reason: "adapter-missing"
    }),
    encodeMetadataFrame(USBPCAP_PIPE_FRAME.captureStart, { generation: 2, address: "19" }),
    encodeUsbPcapPipeFrame(USBPCAP_PIPE_FRAME.data, pcap),
    encodeMetadataFrame(USBPCAP_PIPE_FRAME.captureEnd, { generation: 2, reason: "complete" })
  ]);

  for (const chunkSize of [1, 7, 1024, 64 * 1024]) {
    const decoder = new UsbPcapCaptureStreamDecoder();
    const events = [];
    for (let offset = 0; offset < encoded.length; offset += chunkSize) {
      events.push(...decoder.push(encoded.subarray(offset, offset + chunkSize)));
    }
    decoder.end();
    assert.deepEqual(
      events.filter((event) => event.type === "capture_start").map((event) => event.metadata),
      [{ generation: 1, address: "18" }, { generation: 2, address: "19" }]
    );
    assert.deepEqual(
      events.filter((event) => event.type === "line").map((event) => event.line),
      expectedLines
    );
  }
});

test("capture data without a generation boundary is rejected", () => {
  const decoder = new UsbPcapCaptureStreamDecoder();
  assert.throws(
    () => decoder.push(encodeUsbPcapPipeFrame(USBPCAP_PIPE_FRAME.data, Buffer.from([1]))),
    /outside a capture generation/
  );
});
