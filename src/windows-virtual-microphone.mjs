import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import {
  VIRTUAL_MIC_MESSAGE,
  encodeVirtualMicrophoneMessage
} from "./virtual-microphone-protocol.mjs";

export const VB_CABLE_DOWNLOAD_URL = "https://vb-audio.com/Cable/index.htm";
export const VIRTUAL_MIC_RENDER_ENDPOINT = "CABLE Input (VB-Audio Virtual Cable)";
export const VIRTUAL_MIC_CAPTURE_ENDPOINT = "CABLE Output (VB-Audio Virtual Cable)";
export const LEGACY_VIRTUAL_MIC_RENDER_ENDPOINT = "VibeCoding Remote Microphone Input";
export const LEGACY_VIRTUAL_MIC_CAPTURE_ENDPOINT = "VibeCoding Remote Microphone";

export function classifyVirtualMicrophoneEndpoint(flow, name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const cableDirection = flow === "render" ? "cable input" : "cable output";
  if (normalized.includes(cableDirection) &&
      (normalized.includes("vb-audio") || normalized.includes("vb audio"))) {
    return "vb_cable";
  }
  const legacyExact = flow === "render"
    ? LEGACY_VIRTUAL_MIC_RENDER_ENDPOINT.toLowerCase()
    : LEGACY_VIRTUAL_MIC_CAPTURE_ENDPOINT.toLowerCase();
  if (normalized === legacyExact || normalized.includes("vibecoding remote microphone")) {
    return "vibecoding_legacy";
  }
  return null;
}

export function selectVirtualMicrophonePair(endpoints = []) {
  for (const provider of ["vb_cable", "vibecoding_legacy"]) {
    const renderEndpoint = endpoints.find(
      (endpoint) => endpoint.flow === "render" &&
        classifyVirtualMicrophoneEndpoint("render", endpoint.name) === provider
    );
    const captureEndpoint = endpoints.find(
      (endpoint) => endpoint.flow === "capture" &&
        classifyVirtualMicrophoneEndpoint("capture", endpoint.name) === provider
    );
    if (renderEndpoint && captureEndpoint) {
      return { provider, renderEndpoint, captureEndpoint };
    }
  }
  return null;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "..");

// Tests and development can point VIBE_VIRTUAL_MIC_PUBLISHER_PATH at a Node
// script; run it through the current Node executable instead of exec directly.
function publisherCommand(executablePath, args) {
  return /\.(mjs|cjs|js)$/i.test(executablePath)
    ? { command: process.execPath, args: [executablePath, ...args] }
    : { command: executablePath, args };
}

export function resolveVirtualMicrophonePublisherPath(env = process.env) {
  const explicit = String(env.VIBE_VIRTUAL_MIC_PUBLISHER_PATH || "").trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const resourcesPath = String(env.VIBE_RESOURCES_PATH || "").trim();
  if (resourcesPath) {
    return path.join(resourcesPath, "virtual-microphone", "vibecoding-virtual-mic-publisher.exe");
  }
  return path.join(
    PROJECT_ROOT,
    "build-assets",
    "virtual-microphone",
    "vibecoding-virtual-mic-publisher.exe"
  );
}

export function resolveVirtualMicrophoneRouteStatePath(env = process.env) {
  const explicit = String(env.VIBE_VIRTUAL_MIC_ROUTE_STATE_PATH || "").trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const localAppData = String(env.LOCALAPPDATA || env.TEMP || "").trim();
  if (!localAppData) {
    return path.join(PROJECT_ROOT, "tmp", "virtual-microphone-route-state.txt");
  }
  return path.join(localAppData, "VibeCoding Voice", "virtual-microphone-route-state.txt");
}

export function buildVirtualMicrophonePublisherArgs({
  renderEndpointName,
  captureEndpointName,
  routeStatePath,
  wechatShortcut = false
} = {}) {
  const args = ["--endpoint", String(renderEndpointName || VIRTUAL_MIC_RENDER_ENDPOINT)];
  if (wechatShortcut) {
    args.push(
      "--wechat-shortcut",
      "--capture-endpoint",
      String(captureEndpointName || VIRTUAL_MIC_CAPTURE_ENDPOINT),
      "--route-state",
      String(routeStatePath || resolveVirtualMicrophoneRouteStatePath())
    );
  }
  return args;
}

export function inspectWindowsVirtualMicrophone({ executablePath, env = process.env } = {}) {
  const resolvedPath = executablePath || resolveVirtualMicrophonePublisherPath(env);
  const routeStatePath = resolveVirtualMicrophoneRouteStatePath(env);
  if (process.platform !== "win32") {
    return Promise.resolve({
      supported: false,
      publisherPresent: false,
      renderEndpointPresent: false,
      captureEndpointPresent: false,
      ready: false,
      driverDownloadUrl: VB_CABLE_DOWNLOAD_URL
    });
  }
  if (!fs.existsSync(resolvedPath)) {
    return Promise.resolve({
      supported: true,
      publisherPresent: false,
      renderEndpointPresent: false,
      captureEndpointPresent: false,
      ready: false,
      driverDownloadUrl: VB_CABLE_DOWNLOAD_URL
    });
  }
  const inspect = () => new Promise((resolve) => {
    const listed = publisherCommand(resolvedPath, ["--list"]);
    execFile(listed.command, listed.args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      const endpoints = String(stdout || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
      const pair = selectVirtualMicrophonePair(endpoints);
      const renderEndpoint = pair?.renderEndpoint;
      const captureEndpoint = pair?.captureEndpoint;
      const renderEndpointPresent = Boolean(renderEndpoint);
      const captureEndpointPresent = Boolean(captureEndpoint);
      resolve({
        supported: true,
        publisherPresent: true,
        renderEndpointPresent,
        captureEndpointPresent,
        renderEndpointName: renderEndpoint?.name || null,
        captureEndpointName: captureEndpoint?.name || null,
        provider: pair?.provider || null,
        driverDownloadUrl: VB_CABLE_DOWNLOAD_URL,
        ready: !error && renderEndpointPresent && captureEndpointPresent,
        error: error ? error.message : null
      });
    });
  });
  if (!fs.existsSync(routeStatePath)) {
    return inspect();
  }
  return new Promise((resolve) => {
    const restored = publisherCommand(resolvedPath, ["--restore-route", routeStatePath]);
    execFile(restored.command, restored.args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    }, (recoveryError) => {
      inspect().then((inspection) => {
        if (!recoveryError) {
          resolve(inspection);
          return;
        }
        resolve({
          ...inspection,
          ready: false,
          error: `无法恢复上次使用前的默认麦克风：${recoveryError.message}`
        });
      });
    });
  });
}

function waitForEvent(emitter, eventName, timeoutMs, errorMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(errorMessage));
    }, timeoutMs);
    timer.unref?.();
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      emitter.off(eventName, onEvent);
      emitter.off("error", onError);
    };
    emitter.once(eventName, onEvent);
    emitter.once("error", onError);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WeChat ignores its voice shortcut while an unrelated physical key is still
 * held. That matters for push-to-talk after replacing the old low-level
 * keyboard hook with RegisterHotKey: Windows still exposes the physical
 * F8/Menu key state even though the hotkey message is consumed.
 *
 * Prepare the audio route while push-to-talk is held, then tap WeChat Input
 * Method's Ctrl+Win+Shift start shortcut and replay the buffered PCM after key
 * release. The native publisher taps the same shortcut again after the audio
 * drains and acknowledges the final route restoration, so consecutive presses
 * cannot overlap. A small paced prebuffer keeps WASAPI fed without overflowing
 * the native publisher's bounded queue.
 */
export class BufferedWechatVirtualMicrophoneSession {
  constructor({
    publisher,
    keyReleaseSettleMs = 40,
    replayChunkMs = 100,
    replayLeadMs = 300,
    sleep = wait,
    now = () => Date.now(),
    log
  } = {}) {
    if (!publisher ||
        typeof publisher.ensureReady !== "function" ||
        typeof publisher.prepare !== "function" ||
        typeof publisher.start !== "function" ||
        typeof publisher.write !== "function" ||
        typeof publisher.stop !== "function" ||
        typeof publisher.cancel !== "function") {
      throw new Error("a virtual microphone publisher is required");
    }
    this.publisher = publisher;
    this.keyReleaseSettleMs = Math.max(0, Number(keyReleaseSettleMs) || 0);
    this.replayChunkBytes = Math.max(2, Math.round((Number(replayChunkMs) || 100) * 32 / 2) * 2);
    this.replayLeadMs = Math.max(0, Number(replayLeadMs) || 0);
    this.sleep = sleep;
    this.now = now;
    this.log = typeof log === "function" ? log : () => {};
    this.sequence = 0;
    this.active = null;
  }

  async start() {
    const sequence = ++this.sequence;
    this.active = { sequence, chunks: [], bytes: 0 };
    try {
      // Warm the publisher and switch the default capture route now, but do
      // not trigger WeChat until the physical push-to-talk key is released.
      await this.publisher.ensureReady();
      await this.publisher.prepare();
    } catch (error) {
      if (this.active?.sequence === sequence) {
        this.active = null;
      }
      throw error;
    }
  }

  async write(pcm) {
    const session = this.active;
    if (!session) {
      return;
    }
    const bytes = Buffer.isBuffer(pcm)
      ? Buffer.from(pcm)
      : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    if (!bytes.length) {
      return;
    }
    session.chunks.push(bytes);
    session.bytes += bytes.length;
  }

  async stop() {
    const session = this.active;
    if (!session) {
      return;
    }
    this.active = null;
    const sequence = session.sequence;
    const pcm = Buffer.concat(session.chunks, session.bytes);
    if (!pcm.length) {
      await this.publisher.cancel();
      return;
    }

    await this.sleep(this.keyReleaseSettleMs);
    if (sequence !== this.sequence) {
      return;
    }

    const durationMs = pcm.length / 32;
    this.log("wechat buffered playback starting", {
      pcmBytes: pcm.length,
      durationSeconds: Number((durationMs / 1_000).toFixed(3))
    });
    await this.publisher.start();
    try {
      const replayStartedAt = this.now();
      let sentAudioMs = 0;
      for (let offset = 0; offset < pcm.length; offset += this.replayChunkBytes) {
        if (sequence !== this.sequence) {
          return;
        }
        const chunk = pcm.subarray(offset, Math.min(offset + this.replayChunkBytes, pcm.length));
        await this.publisher.write(chunk);
        sentAudioMs += chunk.length / 32;
        const targetElapsedMs = sentAudioMs - this.replayLeadMs;
        const actualElapsedMs = this.now() - replayStartedAt;
        if (targetElapsedMs > actualElapsedMs) {
          await this.sleep(targetElapsedMs - actualElapsedMs);
        }
      }
      if (sequence !== this.sequence) {
        return;
      }
      await this.publisher.stop();
      this.log("wechat buffered playback completed", { pcmBytes: pcm.length });
    } catch (error) {
      await this.publisher.cancel().catch(() => {});
      throw error;
    }
  }

  async cancel() {
    this.sequence += 1;
    this.active = null;
    await this.publisher.cancel();
  }
}

export class WindowsVirtualMicrophonePublisher {
  constructor({
    executablePath,
    endpointName,
    captureEndpointName,
    routeStatePath,
    wechatShortcut = false,
    log
  } = {}) {
    this.executablePath = executablePath || resolveVirtualMicrophonePublisherPath();
    this.endpointName = endpointName || VIRTUAL_MIC_RENDER_ENDPOINT;
    this.captureEndpointName = captureEndpointName || VIRTUAL_MIC_CAPTURE_ENDPOINT;
    this.routeStatePath = routeStatePath || resolveVirtualMicrophoneRouteStatePath();
    this.wechatShortcut = wechatShortcut === true;
    this.log = typeof log === "function" ? log : () => {};
    this.child = null;
    this.readyPromise = null;
    this.stdoutBuffer = "";
    this.lifecycleState = "idle";
    this.events = new EventEmitter();
    // A permanent listener prevents EventEmitter's special error event from
    // becoming an uncaught exception when no protocol operation is waiting.
    this.events.on("error", () => {});
  }

  async ensureReady() {
    if (process.platform !== "win32") {
      throw new Error("微信模式目前只支持 Windows。");
    }
    if (this.child && !this.child.killed && this.child.exitCode == null) {
      return this.readyPromise;
    }
    if (!fs.existsSync(this.executablePath)) {
      throw new Error(
        `未找到虚拟麦克风音频桥：${this.executablePath}。请重新安装包含虚拟麦克风组件的版本。`
      );
    }

    const inspection = await inspectWindowsVirtualMicrophone({
      executablePath: this.executablePath
    });
    if (!inspection.ready) {
      throw new Error(
        `未找到 VB-CABLE 虚拟声卡。请从 ${VB_CABLE_DOWNLOAD_URL} 下载并安装，重启 Windows 后再试。`
      );
    }
    const resolvedEndpointName = inspection.renderEndpointName || this.endpointName;
    const resolvedCaptureEndpointName = inspection.captureEndpointName || this.captureEndpointName;
    if (this.wechatShortcut) {
      fs.mkdirSync(path.dirname(this.routeStatePath), { recursive: true });
    }
    const args = buildVirtualMicrophonePublisherArgs({
      renderEndpointName: resolvedEndpointName,
      captureEndpointName: resolvedCaptureEndpointName,
      routeStatePath: this.routeStatePath,
      wechatShortcut: this.wechatShortcut
    });
    const launched = publisherCommand(this.executablePath, args);
    const child = spawn(launched.command, launched.args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.stdoutBuffer = "";
    this.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`虚拟麦克风音频桥启动超时：${resolvedEndpointName}`));
        child.kill();
      }, 8_000);
      timer.unref?.();
      const finish = (callback, value) => {
        clearTimeout(timer);
        callback(value);
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const message = JSON.parse(line);
            this.events.emit(message.type, message);
            if (message.type === "ready") {
              finish(resolve, message);
            } else {
              this.log("virtual microphone", message);
            }
          } catch {
            this.log("virtual microphone", line);
          }
        }
      });
      child.once("error", (error) => finish(reject, error));
      child.once("exit", (code) => {
        if (this.child === child) {
          this.child = null;
        }
        this.lifecycleState = "idle";
        const error = new Error(`虚拟麦克风音频桥已退出（代码 ${code ?? "unknown"}）。`);
        this.events.emit("error", error);
        finish(reject, error);
      });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.log("virtual microphone error", chunk.trim()));
    child.stdin.on("error", (error) => this.log("virtual microphone pipe error", error.message));
    return this.readyPromise;
  }

  async prepare() {
    await this.ensureReady();
    if (!this.wechatShortcut || this.lifecycleState === "prepared") {
      return;
    }
    if (this.lifecycleState === "active") {
      throw new Error("上一轮微信语音输入尚未结束。");
    }
    const prepared = this.#waitForPublisherMessage(
      "route_prepared",
      3_000,
      "微信语音输入的麦克风路由预热超时。"
    );
    await this.#write(VIRTUAL_MIC_MESSAGE.PREPARE);
    await prepared;
    this.lifecycleState = "prepared";
  }

  async start() {
    await this.ensureReady();
    if (this.wechatShortcut && this.lifecycleState === "active") {
      throw new Error("上一轮微信语音输入尚未结束。");
    }
    const shortcutPressed = this.wechatShortcut
      ? this.#waitForPublisherMessage(
          "shortcut_pressed",
          3_000,
          "微信语音输入快捷键触发超时。"
        )
      : null;
    await this.#write(VIRTUAL_MIC_MESSAGE.START);
    if (shortcutPressed) {
      await shortcutPressed;
      this.lifecycleState = "active";
    }
  }

  async write(pcm) {
    const bytes = Buffer.isBuffer(pcm)
      ? pcm
      : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    if (bytes.length % 2 !== 0) {
      throw new Error(`PCM16 payload must contain whole samples, got ${bytes.length} bytes`);
    }
    await this.#write(VIRTUAL_MIC_MESSAGE.PCM16, bytes);
  }

  async stop() {
    const sessionIdle = this.wechatShortcut && this.lifecycleState === "active"
      ? this.#waitForPublisherMessage(
          "session_idle",
          5_000,
          "微信语音输入结束和麦克风恢复超时。"
        )
      : null;
    await this.#write(VIRTUAL_MIC_MESSAGE.STOP);
    if (sessionIdle) {
      await sessionIdle;
      this.lifecycleState = "idle";
    }
  }

  async cancel() {
    if (!this.child || this.child.exitCode != null) {
      return;
    }
    const sessionIdle = this.wechatShortcut && this.lifecycleState !== "idle"
      ? this.#waitForPublisherMessage(
          "session_idle",
          5_000,
          "取消微信语音输入并恢复麦克风超时。"
        )
      : null;
    await this.#write(VIRTUAL_MIC_MESSAGE.CANCEL);
    if (sessionIdle) {
      await sessionIdle;
      this.lifecycleState = "idle";
    }
  }

  async dispose() {
    const child = this.child;
    this.child = null;
    this.lifecycleState = "idle";
    if (!child || child.exitCode != null) {
      return;
    }
    try {
      await this.#writeToChild(child, VIRTUAL_MIC_MESSAGE.EXIT);
      child.stdin.end();
      await waitForEvent(child, "exit", 1_500, "virtual microphone helper exit timed out");
    } catch {
      child.kill();
    }
  }

  async #write(type, payload = Buffer.alloc(0)) {
    const child = this.child;
    if (!child || child.exitCode != null || !child.stdin.writable) {
      throw new Error("虚拟麦克风音频桥未运行。");
    }
    return this.#writeToChild(child, type, payload);
  }

  #writeToChild(child, type, payload = Buffer.alloc(0)) {
    const frame = encodeVirtualMicrophoneMessage(type, payload);
    return new Promise((resolve, reject) => {
      child.stdin.write(frame, (error) => (error ? reject(error) : resolve()));
    });
  }

  #waitForPublisherMessage(type, timeoutMs, errorMessage) {
    return waitForEvent(this.events, type, timeoutMs, errorMessage)
      .then(([message]) => message);
  }
}
