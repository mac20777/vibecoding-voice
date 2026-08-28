// A real stuck HID child emits a dense stream of completed Menu cycles. Keep
// the threshold above a plausible burst of deliberate diagnostic clicks: the
// captured fault produced at least six releases inside two seconds, while a
// user pressing the button four times quickly must remain harmless.
const DEFAULT_THRESHOLD = 6;
const DEFAULT_WINDOW_MS = 2_500;
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Detects completed Menu-key press/release cycles that repeat too quickly.
 * Counting releases means a normal held key (and the Home+Menu pairing hold)
 * cannot trip the guard halfway through the hold, when restarting HID could
 * otherwise lose the eventual key-up report.
 */
export class XiaomiRemoteMenuGuard {
  constructor({
    threshold = DEFAULT_THRESHOLD,
    windowMs = DEFAULT_WINDOW_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    now = () => Date.now(),
    onTrip = () => {}
  } = {}) {
    this.threshold = Math.max(2, Number(threshold) || DEFAULT_THRESHOLD);
    this.windowMs = Math.max(250, Number(windowMs) || DEFAULT_WINDOW_MS);
    this.cooldownMs = Math.max(1_000, Number(cooldownMs) || DEFAULT_COOLDOWN_MS);
    this.now = now;
    this.onTrip = onTrip;
    this.homeDown = false;
    this.menuDown = false;
    this.releases = [];
    this.cooldownUntil = 0;
  }

  handle(event = {}) {
    if (event.button === "home") {
      this.homeDown = event.pressed === true;
      if (this.homeDown) {
        this.releases = [];
      }
      return false;
    }

    if (event.button !== "menu") {
      return false;
    }

    if (event.pressed === true) {
      if (this.menuDown) {
        return false;
      }
      this.menuDown = true;
      return false;
    }

    if (this.menuDown !== true) {
      return false;
    }
    this.menuDown = false;

    // Pairing uses Home+Menu. Never restart the HID child while that chord is
    // active; a lost release is exactly the failure this guard is preventing.
    if (this.homeDown) {
      this.releases = [];
      return false;
    }

    const at = Number(this.now());
    this.releases = this.releases.filter((timestamp) => at - timestamp <= this.windowMs);
    this.releases.push(at);
    if (at < this.cooldownUntil || this.releases.length < this.threshold) {
      return false;
    }

    const count = this.releases.length;
    this.releases = [];
    this.cooldownUntil = at + this.cooldownMs;
    try {
      this.onTrip({ count, windowMs: this.windowMs, at });
    } catch {
      // Repair is best-effort; the caller owns logging and retries.
    }
    return true;
  }

  reset() {
    this.homeDown = false;
    this.menuDown = false;
    this.releases = [];
  }
}
