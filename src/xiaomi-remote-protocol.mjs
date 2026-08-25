const CONTROL_HANDLE = "0x0025";
const AUDIO_HANDLES = new Set(["0x0029", "0x002d", "0x0031"]);
const H2_SEQUENCE = Object.freeze([0x08, 0x38, 0xc8, 0xf8]);

export function parseUsbPcapNotificationLine(line) {
  const [rawHandle = "", rawValue = ""] = String(line || "").trim().split("|", 2);
  const handle = rawHandle.toLowerCase();
  const valueHex = rawValue.trim().toLowerCase();
  if (!/^0x[0-9a-f]{4}$/.test(handle) || !/^(?:[0-9a-f]{2})+$/.test(valueHex)) {
    return null;
  }

  return {
    handle,
    value: Buffer.from(valueHex, "hex")
  };
}

export function parseMsbcHidPacket(packet) {
  if (!Buffer.isBuffer(packet) || packet.length !== 60) {
    return null;
  }

  const sequence = packet[1];
  if (packet[0] !== 0x01 || !H2_SEQUENCE.includes(sequence) || packet[2] !== 0xad) {
    return null;
  }

  return {
    sequence,
    frame: Buffer.from(packet.subarray(2, 59))
  };
}

export class XiaomiRemoteProtocolParser {
  constructor() {
    this.active = false;
    this.frameCount = 0;
    this.sequenceErrors = 0;
    this.previousSequence = null;
  }

  pushLine(line) {
    const notification = parseUsbPcapNotificationLine(line);
    if (!notification) {
      return [];
    }

    const { handle, value } = notification;
    if (handle === CONTROL_HANDLE && value.length > 0) {
      if (value[0] === 0x01) {
        return this.#start("control");
      }
      if (value[0] === 0x00) {
        return this.stop("control");
      }
      return [];
    }

    if (!AUDIO_HANDLES.has(handle)) {
      return [];
    }

    const packet = parseMsbcHidPacket(value);
    if (!packet) {
      return [];
    }

    const events = this.active ? [] : this.#start("audio");
    if (this.previousSequence != null) {
      const currentIndex = H2_SEQUENCE.indexOf(this.previousSequence);
      const expected = H2_SEQUENCE[(currentIndex + 1) % H2_SEQUENCE.length];
      if (packet.sequence !== expected) {
        this.sequenceErrors += 1;
      }
    }
    this.previousSequence = packet.sequence;
    this.frameCount += 1;
    events.push({
      type: "audio",
      frame: packet.frame,
      sequence: packet.sequence,
      frameCount: this.frameCount,
      sequenceErrors: this.sequenceErrors
    });
    return events;
  }

  stop(reason = "manual") {
    if (!this.active) {
      return [];
    }

    const event = {
      type: "stop",
      reason,
      frameCount: this.frameCount,
      sequenceErrors: this.sequenceErrors
    };
    this.active = false;
    this.frameCount = 0;
    this.sequenceErrors = 0;
    this.previousSequence = null;
    return [event];
  }

  #start(reason) {
    if (this.active) {
      return [];
    }

    this.active = true;
    this.frameCount = 0;
    this.sequenceErrors = 0;
    this.previousSequence = null;
    return [{ type: "start", reason }];
  }
}

export const XIAOMI_REMOTE_PROTOCOL = Object.freeze({
  controlHandle: CONTROL_HANDLE,
  audioHandles: [...AUDIO_HANDLES],
  h2Sequence: [...H2_SEQUENCE],
  msbcFrameBytes: 57,
  pcmBytesPerFrame: 240,
  sampleRate: 16_000
});
