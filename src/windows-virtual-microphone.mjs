import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  VIRTUAL_MIC_MESSAGE,
  encodeVirtualMicrophoneMessage
} from "./virtual-microphone-protocol.mjs";

export const VIRTUAL_MIC_RENDER_ENDPOINT = "VibeCoding Remote Microphone Input";
export const VIRTUAL_MIC_CAPTURE_ENDPOINT = "VibeCoding Remote Microphone";

function matchesVirtualMicrophoneEndpoint(flow, name) {
  const normalized = String(name || "").trim().toLowerCase();
  const exact = flow === "render"
    ? VIRTUAL_MIC_RENDER_ENDPOINT.toLowerCase()
    : VIRTUAL_MIC_CAPTURE_ENDPOINT.toLowerCase();
  return normalized === exact || normalized.includes("vibecoding remote microphone");
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "..");

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

export function inspectWindowsVirtualMicrophone({ executablePath, env = process.env } = {}) {
  const resolvedPath = executablePath || resolveVirtualMicrophonePublisherPath(env);
  if (process.platform !== "win32") {
    return Promise.resolve({
      supported: false,
      publisherPresent: false,
      renderEndpointPresent: false,
      captureEndpointPresent: false,
      ready: false
    });
  }
  if (!fs.existsSync(resolvedPath)) {
    return Promise.resolve({
      supported: true,
      publisherPresent: false,
      renderEndpointPresent: false,
      captureEndpointPresent: false,
      ready: false
    });
  }
  return new Promise((resolve) => {
    execFile(resolvedPath, ["--list"], {
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
      const renderEndpoint = endpoints.find(
        (endpoint) => endpoint.flow === "render" &&
          matchesVirtualMicrophoneEndpoint("render", endpoint.name)
      );
      const captureEndpoint = endpoints.find(
        (endpoint) => endpoint.flow === "capture" &&
          matchesVirtualMicrophoneEndpoint("capture", endpoint.name)
      );
      const renderEndpointPresent = Boolean(renderEndpoint);
      const captureEndpointPresent = Boolean(captureEndpoint);
      resolve({
        supported: true,
        publisherPresent: true,
        renderEndpointPresent,
        captureEndpointPresent,
        renderEndpointName: renderEndpoint?.name || null,
        captureEndpointName: captureEndpoint?.name || null,
        ready: !error && renderEndpointPresent && captureEndpointPresent,
        error: error ? error.message : null
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

export class WindowsVirtualMicrophonePublisher {
  constructor({ executablePath, endpointName, wechatShortcut = false, log } = {}) {
    this.executablePath = executablePath || resolveVirtualMicrophonePublisherPath();
    this.endpointName = endpointName || VIRTUAL_MIC_RENDER_ENDPOINT;
    this.wechatShortcut = wechatShortcut === true;
    this.log = typeof log === "function" ? log : () => {};
    this.child = null;
    this.readyPromise = null;
    this.stdoutBuffer = "";
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
    const resolvedEndpointName = inspection.renderEndpointName || this.endpointName;
    const args = ["--endpoint", resolvedEndpointName];
    if (this.wechatShortcut) {
      args.push("--wechat-shortcut");
    }
    const child = spawn(this.executablePath, args, {
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
        finish(reject, new Error(`虚拟麦克风音频桥已退出（代码 ${code ?? "unknown"}）。`));
      });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.log("virtual microphone error", chunk.trim()));
    child.stdin.on("error", (error) => this.log("virtual microphone pipe error", error.message));
    return this.readyPromise;
  }

  async start() {
    await this.ensureReady();
    await this.#write(VIRTUAL_MIC_MESSAGE.START);
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
    await this.#write(VIRTUAL_MIC_MESSAGE.STOP);
  }

  async cancel() {
    if (!this.child || this.child.exitCode != null) {
      return;
    }
    await this.#write(VIRTUAL_MIC_MESSAGE.CANCEL);
  }

  async dispose() {
    const child = this.child;
    this.child = null;
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
}
