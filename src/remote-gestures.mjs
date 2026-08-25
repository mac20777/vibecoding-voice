// Turns raw remote button down/up events into click / double-click / hold
// gestures. Volume keys get press-and-hold auto-repeat instead of a hold
// gesture unless the user configured an explicit hold action for them.
//
// Latency notes:
// - click fires immediately on release when no double action is configured;
//   otherwise it waits out the double-click window.
// - hold fires as soon as the threshold passes, without waiting for release.

const DEFAULT_DOUBLE_MS = 300;
const DEFAULT_HOLD_MS = 500;
const DEFAULT_REPEAT_MS = 150;

export class RemoteGestureEngine {
  /**
   * @param {(button: string, gesture: "click"|"double"|"hold"|"repeat") => void} onGesture
   * @param {object} options
   * @param {(button: string, gesture: string) => boolean} options.hasGestureAction
   *        Whether a non-default action is configured for button+gesture.
   * @param {(button: string) => boolean} options.isRepeatButton
   *        Buttons (volume) that auto-repeat their click action while held.
   */
  constructor({ onGesture, hasGestureAction, isRepeatButton, doubleMs, holdMs, repeatMs }) {
    this.onGesture = onGesture;
    this.hasGestureAction = hasGestureAction || (() => false);
    this.isRepeatButton = isRepeatButton || (() => false);
    this.doubleMs = doubleMs ?? DEFAULT_DOUBLE_MS;
    this.holdMs = holdMs ?? DEFAULT_HOLD_MS;
    this.repeatMs = repeatMs ?? DEFAULT_REPEAT_MS;
    this.states = new Map();
  }

  #state(button) {
    let state = this.states.get(button);
    if (!state) {
      state = { phase: "idle", holdTimer: null, clickTimer: null, repeatTimer: null };
      this.states.set(button, state);
    }
    return state;
  }

  #clearTimers(state) {
    for (const key of ["holdTimer", "clickTimer", "repeatTimer"]) {
      if (state[key]) {
        clearTimeout(state[key]);
        clearInterval(state[key]);
        state[key] = null;
      }
    }
  }

  #reset(button) {
    const state = this.#state(button);
    this.#clearTimers(state);
    state.phase = "idle";
  }

  handleButtonEvent(event) {
    const button = String(event?.button || "");
    if (!button) {
      return;
    }
    if (event.pressed) {
      this.#onDown(button);
    } else {
      this.#onUp(button);
    }
  }

  #onDown(button) {
    const state = this.#state(button);

    if (state.phase === "waitSecondDown") {
      // Second press inside the double-click window: cancel the pending click.
      this.#clearTimers(state);
      state.phase = "secondDown";
      this.#armHold(button, state);
      return;
    }

    this.#reset(button);
    state.phase = "down";
    this.#armHold(button, state);
  }

  #armHold(button, state) {
    state.holdTimer = setTimeout(() => {
      state.holdTimer = null;
      if (this.hasGestureAction(button, "hold")) {
        this.onGesture(button, "hold");
        state.phase = "held";
        return;
      }
      if (this.isRepeatButton(button)) {
        // Volume keys: nudge once at the threshold, then keep nudging.
        this.onGesture(button, "repeat");
        state.phase = "repeating";
        state.repeatTimer = setInterval(() => this.onGesture(button, "repeat"), this.repeatMs);
        return;
      }
      state.phase = "held";
    }, this.holdMs);
  }

  #onUp(button) {
    const state = this.#state(button);

    if (state.phase === "held" || state.phase === "repeating") {
      this.#reset(button);
      return;
    }

    if (state.phase === "secondDown") {
      this.#clearTimers(state);
      state.phase = "idle";
      this.onGesture(button, "double");
      return;
    }

    if (state.phase !== "down") {
      return;
    }

    this.#clearTimers(state);
    if (!this.hasGestureAction(button, "double")) {
      state.phase = "idle";
      this.onGesture(button, "click");
      return;
    }

    state.phase = "waitSecondDown";
    state.clickTimer = setTimeout(() => {
      state.clickTimer = null;
      state.phase = "idle";
      this.onGesture(button, "click");
    }, this.doubleMs);
  }

  dispose() {
    for (const button of this.states.keys()) {
      this.#reset(button);
    }
    this.states.clear();
  }
}
