const CONTROL_HANDLE = "0x0025";
const AUDIO_HANDLES = new Set(["0x0029", "0x002d", "0x0031"]);
const H2_SEQUENCE = Object.freeze([0x08, 0x38, 0xc8, 0xf8]);

// The remaining keys arrive on handle 0x0017 as standard 8-byte HID keyboard
// reports: byte2 is the usage code while held, all-zero on release.
const BUTTON_HANDLE = "0x0017";
const BUTTON_CODES = Object.freeze({
  0x52: "up",
  0x51: "down",
  0x50: "left",
  0x4f: "right",
  0x28: "ok",
  0xf1: "back",
  0x4a: "home",
  0x80: "volume_up",
  0x81: "volume_down",
  // USB HID Keyboard/Keypad usage 0x65 is the Application/Menu key. Windows
  // also handles it through the native HID keyboard path, so the desktop app
  // suppresses that physical VK_APPS event and keeps this copy configurable.
  0x65: "menu",
  // Observed from the Xiaomi remote's standard HID report in the desktop log.
  // Keep this as a normal mappable button; its default action lives in
  // remote-buttons.mjs rather than being hard-coded in the protocol parser.
  0x66: "power",
  // The voice key also mirrors onto 0x0017; the 0x0025 control channel owns it,
  // so it is parsed but never reported as a mappable button.
  0x3e: "voice"
});

export function parseHidButtonReport(packet) {
  if (!Buffer.isBuffer(packet) || packet.length !== 8) {
    return null;
  }
  const code = packet[2];
  const pressed = packet.some((byte) => byte !== 0);
  if (pressed && (packet[0] !== 0 || packet[1] !== 0 || code === 0)) {
    return null;
  }
  return {
    code,
    button: BUTTON_CODES[code] || "unknown",
    pressed
  };
}

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
    this.buttonDownCode = 0;
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

    if (handle === BUTTON_HANDLE) {
      const report = parseHidButtonReport(value);
      if (!report) {
        // A packet on the button handle that is not the standard 8-byte
        // keyboard report — some keys (power/menu) may use a different report
        // format. Surface it once so the key can be identified from the log.
        return [{ type: "unknown_report", handle, valueHex: value.toString("hex") }];
      }
      // A release report is all zeros, so it only makes sense relative to the
      // code currently held down.
      const code = report.pressed ? report.code : this.buttonDownCode;
      this.buttonDownCode = report.pressed ? report.code : 0;
      const button = BUTTON_CODES[code] || "unknown";
      if (button === "voice" || code === 0) {
        return [];
      }
      return [{ type: "button", code, button, pressed: report.pressed }];
    }

    if (!AUDIO_HANDLES.has(handle)) {
      // Notifications on any other handle (consumer-control reports, battery,
      // …) are not parsed yet; surface them so new keys can be identified.
      return [{ type: "unknown_handle", handle, valueHex: value.toString("hex") }];
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
  buttonHandle: BUTTON_HANDLE,
  buttonCodes: { ...BUTTON_CODES },
  h2Sequence: [...H2_SEQUENCE],
  msbcFrameBytes: 57,
  pcmBytesPerFrame: 240,
  sampleRate: 16_000
});
