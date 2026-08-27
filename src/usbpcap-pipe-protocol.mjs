import { UsbPcapAttLineParser } from "./usbpcap-att-parser.mjs";

const FRAME_HEADER_BYTES = 5;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export const USBPCAP_PIPE_FRAME = Object.freeze({
  captureStart: 1,
  data: 2,
  captureEnd: 3
});
const VALID_FRAME_TYPES = new Set(Object.values(USBPCAP_PIPE_FRAME));

function parseMetadata(payload) {
  if (!payload.length) {
    return {};
  }
  try {
    const value = JSON.parse(payload.toString("utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function encodeUsbPcapPipeFrame(type, payload = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(payload)) {
    payload = Buffer.from(payload);
  }
  if (!VALID_FRAME_TYPES.has(type)) {
    throw new Error(`usbpcap-pipe: unknown frame type ${type}`);
  }
  if (payload.length > MAX_FRAME_BYTES) {
    throw new Error(`usbpcap-pipe: frame is too large (${payload.length} bytes)`);
  }
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header[0] = type;
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export class UsbPcapPipeFrameDecoder {
  #header = Buffer.alloc(FRAME_HEADER_BYTES);
  #headerBytes = 0;
  #frameType = 0;
  #payload = null;
  #payloadBytes = 0;
  #ended = false;

  push(chunk) {
    if (this.#ended) {
      throw new Error("usbpcap-pipe: push() after end()");
    }
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk);
    }
    const frames = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#headerBytes < FRAME_HEADER_BYTES) {
        const count = Math.min(FRAME_HEADER_BYTES - this.#headerBytes, chunk.length - offset);
        chunk.copy(this.#header, this.#headerBytes, offset, offset + count);
        this.#headerBytes += count;
        offset += count;
        if (this.#headerBytes < FRAME_HEADER_BYTES) {
          continue;
        }
        this.#frameType = this.#header[0];
        const length = this.#header.readUInt32LE(1);
        if (!VALID_FRAME_TYPES.has(this.#frameType)) {
          throw new Error(`usbpcap-pipe: unknown frame type ${this.#frameType}`);
        }
        if (length > MAX_FRAME_BYTES) {
          throw new Error(`usbpcap-pipe: frame is too large (${length} bytes)`);
        }
        this.#payload = Buffer.alloc(length);
        this.#payloadBytes = 0;
        if (length === 0) {
          frames.push({ type: this.#frameType, payload: this.#payload });
          this.#resetFrame();
        }
      }
      if (!this.#payload) {
        continue;
      }
      const count = Math.min(this.#payload.length - this.#payloadBytes, chunk.length - offset);
      chunk.copy(this.#payload, this.#payloadBytes, offset, offset + count);
      this.#payloadBytes += count;
      offset += count;
      if (this.#payloadBytes === this.#payload.length) {
        frames.push({ type: this.#frameType, payload: this.#payload });
        this.#resetFrame();
      }
    }
    return frames;
  }

  end() {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    if (this.#headerBytes || this.#payload) {
      const trailing = this.#headerBytes + this.#payloadBytes;
      throw new Error(`usbpcap-pipe: truncated frame (${trailing} trailing bytes)`);
    }
  }

  #resetFrame() {
    this.#headerBytes = 0;
    this.#frameType = 0;
    this.#payload = null;
    this.#payloadBytes = 0;
  }
}

/**
 * Decodes the framed helper stream and creates a fresh pcap parser for every
 * capture generation. A USB adapter removal can truncate a pcap record; the
 * next generation must never be appended to that stale parser state.
 */
export class UsbPcapCaptureStreamDecoder {
  #frames = new UsbPcapPipeFrameDecoder();
  #parser = null;
  #dataBytes = 0;
  #ended = false;

  get dataBytes() {
    return this.#dataBytes;
  }

  push(chunk) {
    if (this.#ended) {
      throw new Error("usbpcap-capture-stream: push() after end()");
    }
    const events = [];
    for (const frame of this.#frames.push(chunk)) {
      if (frame.type === USBPCAP_PIPE_FRAME.captureStart) {
        // Deliberately discard a possibly partial parser from the prior
        // generation. The new data frame includes its own pcap global header.
        this.#parser = new UsbPcapAttLineParser();
        events.push({ type: "capture_start", metadata: parseMetadata(frame.payload) });
        continue;
      }
      if (frame.type === USBPCAP_PIPE_FRAME.captureEnd) {
        this.#parser = null;
        events.push({ type: "capture_end", metadata: parseMetadata(frame.payload) });
        continue;
      }
      if (!this.#parser) {
        throw new Error("usbpcap-capture-stream: data arrived outside a capture generation");
      }
      this.#dataBytes += frame.payload.length;
      for (const line of this.#parser.push(frame.payload)) {
        events.push({ type: "line", line });
      }
    }
    return events;
  }

  end() {
    if (this.#ended) {
      return [];
    }
    this.#ended = true;
    this.#frames.end();
    this.#parser = null;
    return [];
  }
}
