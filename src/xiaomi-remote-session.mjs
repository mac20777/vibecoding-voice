import { XiaomiRemoteProtocolParser } from "./xiaomi-remote-protocol.mjs";

const DEFAULT_INACTIVITY_MS = 900;
const MIN_INACTIVITY_MS = 250;

/**
 * Tracks one push-to-talk voice session for the Xiaomi remote and bridges it
 * to the local WebSocket server. The inactivity timer is armed on the session
 * start as well as on every audio frame, so a key press that yields no audio
 * (for example after the remote slept and its notification stream did not
 * resume) is cancelled instead of latching the parser forever.
 */
export class XiaomiRemoteSessionController {
  constructor({ sendJson, sendAudio, decodeFrames, log, source, inactivityMs }) {
    if (
      typeof sendJson !== "function" ||
      typeof sendAudio !== "function" ||
      typeof decodeFrames !== "function"
    ) {
      throw new Error("sendJson, sendAudio and decodeFrames are required");
    }
    this.parser = new XiaomiRemoteProtocolParser();
    this.sendJson = sendJson;
    this.sendAudio = sendAudio;
    this.decodeFrames = decodeFrames;
    this.log = typeof log === "function" ? log : () => {};
    this.source = source || "xiaomi_remote";
    this.inactivityMs = Math.max(MIN_INACTIVITY_MS, Number(inactivityMs) || DEFAULT_INACTIVITY_MS);
    this.session = null;
    this.decoding = false;
    this.inactivityTimer = null;
  }

  pushLine(line) {
    for (const event of this.parser.pushLine(line)) {
      void this.handleEvent(event);
    }
  }

  dispose() {
    this.#clearInactivityTimer();
  }

  async handleEvent(event) {
    if (event.type === "start") {
      if (this.decoding || this.session) {
        this.log("voice key down ignored: previous session still active");
        // A dropped start must not leave the parser marked active while this
        // controller has no session, or every later key press is swallowed.
        this.parser.stop("busy");
        return;
      }
      this.session = { frames: [], startedAt: Date.now() };
      this.sendJson({ type: "ptt_start", source: this.source, ts: Date.now() });
      this.log("voice key down");
      this.#armInactivityTimer();
      return;
    }

    if (event.type === "audio") {
      if (!this.session || this.decoding) {
        return;
      }
      this.session.frames.push(event.frame);
      this.#armInactivityTimer();
      return;
    }

    if (event.type === "button") {
      this.sendJson({
        type: "remote_button",
        button: event.button,
        code: event.code,
        pressed: event.pressed,
        source: this.source,
        ts: Date.now()
      });
      // Unknown codes surface here so a new key (for example the menu key) can
      // be identified from the log and added to the code table.
      this.log(event.pressed ? "button down" : "button up", {
        button: event.button,
        code: `0x${event.code.toString(16).padStart(2, "0")}`
      });
      return;
    }

    if (event.type === "stop") {
      await this.#finishSession(event);
    }
  }

  #clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  #armInactivityTimer() {
    this.#clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      for (const event of this.parser.stop("inactivity")) {
        void this.handleEvent(event);
      }
    }, this.inactivityMs);
    this.inactivityTimer.unref?.();
  }

  async #finishSession(event) {
    this.#clearInactivityTimer();
    if (!this.session) {
      return;
    }

    const completed = this.session;
    this.session = null;
    if (completed.frames.length === 0) {
      this.log("voice session ignored: no audio frames");
      this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
      return;
    }

    this.decoding = true;
    try {
      this.log("decoding voice", {
        frames: completed.frames.length,
        sequenceErrors: event.sequenceErrors,
        reason: event.reason
      });
      const pcm = await this.decodeFrames(completed.frames);
      this.sendAudio(pcm);
      this.sendJson({ type: "ptt_stop", source: this.source, ts: Date.now() });
      this.log("voice sent", {
        pcmBytes: pcm.length,
        durationSeconds: Number((pcm.length / 2 / 16_000).toFixed(3))
      });
    } catch (error) {
      this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
      this.log("decode failed", error?.message || String(error));
    } finally {
      this.decoding = false;
    }
  }
}
