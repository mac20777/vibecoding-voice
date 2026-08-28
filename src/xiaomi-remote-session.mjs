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
  constructor({
    sendJson,
    sendAudio,
    decodeFrames,
    streamAudio,
    log,
    source,
    inactivityMs,
    onButtonEvent
  }) {
    const hasBatchAudio = typeof sendAudio === "function" && typeof decodeFrames === "function";
    const hasStreamingAudio =
      streamAudio &&
      typeof streamAudio.start === "function" &&
      typeof streamAudio.decodeFrame === "function" &&
      typeof streamAudio.write === "function" &&
      typeof streamAudio.stop === "function" &&
      typeof streamAudio.cancel === "function";
    if (typeof sendJson !== "function" || (!hasBatchAudio && !hasStreamingAudio)) {
      throw new Error("sendJson and either batch or streaming audio handlers are required");
    }
    this.parser = new XiaomiRemoteProtocolParser();
    this.sendJson = sendJson;
    this.sendAudio = sendAudio;
    this.decodeFrames = decodeFrames;
    this.streamAudio = hasStreamingAudio ? streamAudio : null;
    this.log = typeof log === "function" ? log : () => {};
    this.onButtonEvent = typeof onButtonEvent === "function" ? onButtonEvent : () => {};
    this.source = source || "xiaomi_remote";
    this.inactivityMs = Math.max(MIN_INACTIVITY_MS, Number(inactivityMs) || DEFAULT_INACTIVITY_MS);
    this.session = null;
    this.decoding = false;
    this.inactivityTimer = null;
    this.seenUnknownPackets = new Set();
    this.generation = 0;
    this.eventQueue = Promise.resolve();
  }

  pushLine(line) {
    for (const event of this.parser.pushLine(line)) {
      if (this.streamAudio) {
        const generation = this.generation;
        this.eventQueue = this.eventQueue
          .then(() => {
            if (generation === this.generation) {
              return this.handleEvent(event);
            }
            return undefined;
          })
          .catch((error) => this.log("remote event failed", error?.message || String(error)));
      } else {
        void this.handleEvent(event);
      }
    }
  }

  dispose() {
    this.#clearInactivityTimer();
    const hadActiveSession = Boolean(this.session);
    this.session = null;
    this.generation += 1;
    if (hadActiveSession && this.streamAudio) {
      this.eventQueue = this.eventQueue
        .then(() => this.#cancelStreamingSession("dispose"))
        .catch((error) => this.log("voice stream dispose failed", error?.message || String(error)));
    }
    return this.eventQueue;
  }

  reset(reason = "capture_restart") {
    const hadActiveSession = Boolean(this.session || this.decoding);
    this.generation += 1;
    this.#clearInactivityTimer();
    this.parser = new XiaomiRemoteProtocolParser();
    this.session = null;
    this.decoding = false;
    if (hadActiveSession) {
      if (this.streamAudio) {
        // Keep old-generation cancellation ordered behind any in-flight write
        // and ahead of events from the next capture generation. Otherwise a
        // late cancel can terminate the user's next voice session.
        this.eventQueue = this.eventQueue
          .then(() => this.#cancelStreamingSession(reason))
          .catch((error) => this.log("voice stream reset failed", error?.message || String(error)));
      }
      this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
    }
    this.log("remote capture state reset", { reason, generation: this.generation });
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
      const nextSession = { frames: [], startedAt: Date.now(), streamingFailed: false };
      this.session = nextSession;
      if (this.streamAudio) {
        try {
          nextSession.streamReady = Promise.resolve().then(() => this.streamAudio.start());
          await nextSession.streamReady;
          if (this.session !== nextSession) {
            await this.#cancelStreamingSession("session_superseded");
            return;
          }
        } catch (error) {
          if (this.session === nextSession) {
            this.session = null;
          }
          this.parser.stop("stream_start_failed");
          this.log("voice stream failed to start", error?.message || String(error));
          this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
          return;
        }
      }
      this.sendJson({ type: "ptt_start", source: this.source, ts: Date.now() });
      this.log("voice key down");
      this.#armInactivityTimer();
      return;
    }

    if (event.type === "audio") {
      if (!this.session || this.decoding) {
        return;
      }
      const activeSession = this.session;
      activeSession.frames.push(event.frame);
      if (this.streamAudio && !activeSession.streamingFailed) {
        try {
          await activeSession.streamReady;
          if (this.session !== activeSession) {
            return;
          }
          const pcm = await this.streamAudio.decodeFrame(event.frame);
          if (pcm?.length) {
            await this.streamAudio.write(pcm);
          }
        } catch (error) {
          activeSession.streamingFailed = true;
          this.log("voice stream failed", error?.message || String(error));
          await this.#cancelStreamingSession("stream_error");
        }
      }
      this.#armInactivityTimer();
      return;
    }

    if (event.type === "button") {
      const ts = Date.now();
      this.onButtonEvent(event);
      this.sendJson({
        type: "remote_button",
        button: event.button,
        code: event.code,
        pressed: event.pressed,
        source: this.source,
        ts
      });
      // Unknown codes surface here so a new key (for example the menu key) can
      // be identified from the log and added to the code table.
      this.log(event.pressed ? "button down" : "button up", {
        button: event.button,
        code: `0x${event.code.toString(16).padStart(2, "0")}`
      });
      return;
    }

    if (event.type === "unknown_report" || event.type === "unknown_handle") {
      // Unparsed HID traffic (a key whose report format or handle we do not
      // know yet, e.g. power/menu). Unknown audio handles can carry thousands
      // of unique compressed frames, so group them by packet shape and prefix
      // instead of flooding the log with every payload.
      const key = event.type === "unknown_handle"
        ? `${event.type}:${event.handle}:${event.valueHex.length}:${event.valueHex.slice(0, 6)}`
        : `${event.type}:${event.handle}:${event.valueHex}`;
      if (!this.seenUnknownPackets.has(key)) {
        this.seenUnknownPackets.add(key);
        this.log("unparsed HID packet — press a mapped key and report this line", {
          handle: event.handle,
          value: event.valueHex
        });
      }
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
      if (this.streamAudio) {
        try {
          await completed.streamReady;
        } catch {
          // The start path already reported the actionable error.
        }
        await this.#cancelStreamingSession("no_audio");
      }
      this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
      return;
    }

    if (this.streamAudio) {
      try {
        await completed.streamReady;
      } catch (error) {
        await this.#cancelStreamingSession("stream_start_failed");
        this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
        this.log("voice stream failed to become ready", error?.message || String(error));
        return;
      }
      if (completed.streamingFailed) {
        this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
        return;
      }
      try {
        await this.streamAudio.stop();
        this.sendJson({ type: "ptt_stop", source: this.source, ts: Date.now() });
        this.log("voice stream sent", {
          frames: completed.frames.length,
          sequenceErrors: event.sequenceErrors,
          reason: event.reason
        });
      } catch (error) {
        await this.#cancelStreamingSession("stream_stop_failed");
        this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
        this.log("voice stream failed to stop", error?.message || String(error));
      }
      return;
    }

    const generation = this.generation;
    this.decoding = true;
    try {
      this.log("decoding voice", {
        frames: completed.frames.length,
        sequenceErrors: event.sequenceErrors,
        reason: event.reason
      });
      const pcm = await this.decodeFrames(completed.frames);
      if (generation !== this.generation) {
        return;
      }
      this.sendAudio(pcm);
      this.sendJson({ type: "ptt_stop", source: this.source, ts: Date.now() });
      this.log("voice sent", {
        pcmBytes: pcm.length,
        durationSeconds: Number((pcm.length / 2 / 16_000).toFixed(3))
      });
    } catch (error) {
      if (generation === this.generation) {
        this.sendJson({ type: "ptt_cancel", source: this.source, ts: Date.now() });
        this.log("decode failed", error?.message || String(error));
      }
    } finally {
      if (generation === this.generation) {
        this.decoding = false;
      }
    }
  }

  async #cancelStreamingSession(reason) {
    if (!this.streamAudio) {
      return;
    }
    try {
      await this.streamAudio.cancel(reason);
    } catch (error) {
      this.log("voice stream cancel failed", error?.message || String(error));
    }
  }
}
