# vibecoding-voice

[English](#english) · [中文](#中文)

Follow the author on X: [@mac20777](https://x.com/intent/follow?screen_name=mac20777)

---

## English

**Voice-driven AI coding via a wireless ESP32 e-paper device — no microphone, no keyboard interruption, just push-to-talk.**

`vibecoding-voice` is a two-part open-source project:

1. **Host bridge** (this repo) — a Node.js server that runs on your PC. It receives push-to-talk audio from an ESP32 device over WebSocket, transcribes it, and either injects the text into the active Windows input field or drives a Codex / Claude Code CLI session.
2. **ESP32 firmware** (`firmware/`) — runs on a Zectrix S3 or Waveshare S3 e-paper board. It handles Wi-Fi, push-to-talk recording, device-side confirmation UI, and renders live CLI output on the e-ink screen.

### What it looks like in practice

You hold a button on the device, speak a coding instruction, release the button, and within a second the transcribed text is sent to Claude Code or Codex. The AI agent's progress — which tools it's calling, what it wrote — streams back to the e-paper screen in real time. Your hands stay on the keyboard; the device is a voice remote for your AI coding assistant.

```
┌─────────────────────────────────────────────────┐
│  ESP32 e-paper device (LAN Wi-Fi)               │
│  ┌──────┐   PTT audio (PCM16 16kHz)             │
│  │ MIC  │──────────────────────────────────┐    │
│  └──────┘                                  ▼    │
│  ┌──────────┐   WebSocket        ┌──────────────┤
│  │ e-paper  │◄───── CLI state ───│  Host bridge │
│  │ display  │                    │  (Node.js)   │
│  └──────────┘                    └──────┬───────┘
└─────────────────────────────────────────┼───────┘
                                          │ transcript
                                          ▼
                              ┌───────────────────┐
                              │  Codex CLI  or    │
                              │  Claude Code CLI  │
                              └───────────────────┘
```

### Supported Hardware

| Board | Screen | Status |
|-------|--------|--------|
| [Zectrix S3 e-paper 4.2"](https://www.zectrix.ai/) | 400×300 grayscale e-ink | ✅ Primary dev board |
| Waveshare ESP32-S3 e-paper 1.54" | 200×200 B/W e-ink | ✅ Supported |

Both boards use ESP32-S3 with onboard MEMS mic and push-button.

### Features

- 16 kHz mono PCM audio ingest over WebSocket
- STT via Volcengine Flash ASR or OpenAI Whisper
- Windows text injection via clipboard (Ctrl+V)
- Managed `codex exec --json` session bridge
- Managed `claude -p --output-format stream-json` session bridge
- Live CLI status, prompt/reply summary, log tail, and quota snapshot projected to e-paper
- **Multi-segment accumulation** — hold BOOT to keep appending speech, UP to send, DN to undo the last segment
- Device-side confirm flow: transcript shown first, explicit action required to send
- UDP LAN host discovery — device finds the bridge automatically, no hardcoded IPs
- HMAC-SHA256 authentication for both discovery and WebSocket handshake
- NVS-persisted host pairing — reconnects to the last known server on reboot

---

### Part 1 — Host Bridge

#### Requirements

- Node.js 20 or newer
- Windows (for text injection; the server itself runs on any OS)
- Codex CLI or Claude Code CLI on your `PATH` (only for CLI session modes)
- An STT provider key:
  - Volcengine: `VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY`
  - OpenAI: `OPENAI_API_KEY`

#### Quick Start

**1. Install**

Recommended global install:

```powershell
npm install -g @mac20777/vibecoding-voice
```

From source (development):

```powershell
npm install
```

**2. Configure**

```powershell
vibe config
```

On first run, `vibe`, `vibe codex`, and `vibe claude` will launch this setup wizard automatically if the STT keys are missing.

The wizard saves user-level config to:

- Windows: `%APPDATA%\vibecoding-voice\config.env`
- macOS: `~/Library/Application Support/vibecoding-voice/config.env`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/vibecoding-voice/config.env`

You can still use environment variables or a local `.env` file. A local `.env` overrides the user-level config.

Minimum config for Codex + Volcengine:

```env
STT_PROVIDER=volcengine
VOLCENGINE_APP_KEY=your-app-key
VOLCENGINE_ACCESS_KEY=your-access-key
TRANSCRIPT_DELIVERY_MODE=confirm_on_device
LAN_SHARED_SECRET=replace-with-a-long-random-secret
```

`vibe codex`, `vibe claude`, and `vibe` choose the send target for you. You only need `SEND_TARGET` when launching `src/server.mjs` directly.

**3. Run**

```powershell
vibe codex
```

The server prints the WebSocket URL and UDP discovery address on startup. The bridge is ready as soon as you see `server ready`.

**4. Diagnose (optional)**

```powershell
vibe doctor
```

Checks CLI tools, API keys, port availability, and STT provider connectivity.

#### Command Reference

| Command | Purpose |
|---------|---------|
| `vibe` | Start in text injection mode |
| `vibe codex` | Start bridge + console in Codex mode |
| `vibe claude` | Start bridge + console in Claude Code mode |
| `vibe config` | Run the interactive setup / repair wizard |
| `vibe doctor` | Validate config, keys, CLI binaries, and ports |

#### Configuration Priority

Configuration is loaded in this order, lowest to highest priority:

1. User config file: `config.env`
2. Repo root `.env`
3. Current working directory `.env`
4. Environment variables from the current shell

This means a local `.env` in your current project overrides the saved user-level config.

#### Troubleshooting

- `vibe` says STT is not configured:
  Run `vibe config` and enter either Volcengine or OpenAI credentials.
- `vibe config` saved successfully, but old values are still used:
  Run `vibe doctor` and check whether a local `.env` is overriding the user config.
- You want different settings per project:
  Keep your default keys in `config.env`, then add a project-local `.env` only when needed.

---

### Part 2 — ESP32 Firmware

#### Option A: Flash a pre-built release

Download the latest zip from [`firmware/releases/`](firmware/releases/), unzip, and run:

```powershell
# Replace COMx with your board's serial port
python -m esptool --chip esp32s3 -p COMx -b 460800 write_flash "@flash_args"
```

#### Option B: Build from source

Requires ESP-IDF v5.5.

```powershell
cd firmware
# Windows (auto-detects Espressif toolchain at D:\Espressif)
.\build_windows.ps1 -Flash -Port COMx
```

#### Firmware Configuration

The firmware is pre-configured for LAN discovery mode. The only value you **must** set before building is the shared secret:

In `firmware/sdkconfig` (or via `idf.py menuconfig → LAN Mic`):

```
CONFIG_LAN_SHARED_SECRET="your-secret-here"
```

Set the same value in the host bridge config. Any of these is fine:

- run `vibe config`
- set `LAN_SHARED_SECRET` in a local `.env`
- export `LAN_SHARED_SECRET` in your shell

Example:

```env
LAN_SHARED_SECRET=your-secret-here
```

> **Security**: Never commit the secret to git. Generate a long random hex string (`openssl rand -hex 32`).

#### First Boot

1. Power on the device. It enters **Wi-Fi config AP mode** automatically on first boot.
2. The e-paper screen shows the AP SSID, password, and `http://192.168.4.1`.
3. Connect to that AP from a phone or laptop and open the config page.
4. Enter your Wi-Fi credentials and save.
5. The device reboots, connects to your Wi-Fi, discovers the bridge via UDP, and shows **Ready** on screen.

To re-enter config mode later: hold **UP + DOWN** until the screen clears.

#### Board Notes

- Use the provided flashing flow in `firmware/build_windows.ps1` when possible. The post-flash reset mode matters on this board.
- If you are validating the very first boot after flashing, test it once before attaching a serial monitor. Opening the monitor can trigger an extra USB reset and hide the original behavior.
- If the board behaves differently after flashing vs. after a later USB reset, check the reset path first before assuming the reconnect logic is broken.
- Maintainer-only bring-up notes and regression checks are documented in `CONTRIBUTING.md`.

---

### Device Button Reference

| Button | Connection state | Action |
|--------|-----------------|--------|
| Hold BOOT | Connected | Record a speech segment |
| BOOT (release) | Awaiting confirm | Append another segment to pending transcript |
| BOOT (press) | Disconnected | Force immediate reconnect attempt |
| UP click | Awaiting confirm | Send accumulated transcript to CLI |
| DN click | Awaiting confirm | Undo last segment (cancel all if only one left) |
| Hold UP + DN | Any | Re-enter Wi-Fi setup mode |

Screen footer shows `BOOT Add · UP Send · DN Undo` when a transcript is pending.

---

### Configuration Reference

#### STT

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PROVIDER` | auto-detect | `volcengine` or `openai` |
| `VOLCENGINE_APP_KEY` | — | Volcengine app key |
| `VOLCENGINE_ACCESS_KEY` | — | Volcengine access key |
| `VOLCENGINE_RESOURCE_ID` | `volc.bigasr.auc_turbo` | ASR resource ID |
| `VOLCENGINE_LANGUAGE` | `zh-CN` | Recognition language |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Transcription model |
| `OPENAI_TRANSCRIBE_LANGUAGE` | — | e.g. `zh` |

#### Network

| Variable | Default | Description |
|----------|---------|-------------|
| `LAN_VOICE_PORT` | `8765` | WebSocket port |
| `LAN_DISCOVERY_ENABLED` | `1` | Enable UDP host discovery |
| `LAN_DISCOVERY_PORT` | `8766` | UDP discovery port |
| `LAN_DISCOVERY_HOST_ID` | — | Stable host ID (for multi-bridge LAN) |
| `LAN_SHARED_SECRET` | — | HMAC auth secret (**strongly recommended**) |
| `LAN_AUTH_WINDOW_SEC` | `300` | Timestamp freshness window in seconds |

#### Send Target

| Variable | Default | Description |
|----------|---------|-------------|
| `SEND_TARGET` | `text_injector` | `text_injector`, `codex_exec`, or `claude_code` |
| `TRANSCRIPT_DELIVERY_MODE` | `immediate` | `immediate` or `confirm_on_device` |
| `TEXT_INJECTION_MODE` | `type_only` | `type_only` or `type_and_enter` |

#### CLI Session

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_COMMAND` | `codex` | Codex CLI binary path |
| `CODEX_CWD` | `.` | Working directory for Codex |
| `CODEX_SKIP_GIT_REPO_CHECK` | — | Set `1` to pass `--skip-git-repo-check` |
| `CLAUDE_COMMAND` | auto-detect | Claude Code CLI path |
| `CLAUDE_CWD` | project root | Working directory for Claude |
| `CLAUDE_ALLOWED_TOOLS` | `Read,Edit,Write,Bash,Glob,Grep` | Pre-approved tools |
| `CLAUDE_MAX_TURNS` | `10` | Max agentic turns per prompt |
| `CLI_TIMEOUT_SEC` | `300` | Kill CLI subprocess after N seconds |

#### Debug

| Variable | Default | Description |
|----------|---------|-------------|
| `DRY_RUN_TEXT_INJECTION` | — | Set `1` to log injections without keystrokes |
| `MOCK_TRANSCRIPT` | — | Fixed transcript text, bypasses STT |
| `SAVE_DEBUG_WAV` | — | Set `1` to save each audio segment to `tmp/` |

---

### Development

```powershell
npm test                             # run all tests
node --test test/lan-auth.test.mjs   # run a single test file
node scripts/mock-client.mjs         # simulate a device connection
```

Debug workflow (source mode): `MOCK_TRANSCRIPT=hello world DRY_RUN_TEXT_INJECTION=1 node src/server.mjs`

---

### Security and Privacy

- Keep `.env` local — it is git-ignored and must never be committed.
- Always set `LAN_SHARED_SECRET` on a shared or untrusted LAN.
- Audio is sent to the configured STT provider; review provider data retention and privacy terms before use in sensitive environments.
- Codex may store session history under `~/.codex/`.
- Text injection temporarily uses the clipboard and restores the previous content when possible.

---

## 中文

**用无线 ESP32 电子墨水设备实现语音驱动的 AI 编程——无需抢占麦克风，无需中断键盘，按键说话即可。**

`vibecoding-voice` 是一个由两部分组成的开源项目：

1. **主机桥接服务**（本仓库）— 运行在你电脑上的 Node.js 服务器。它通过 WebSocket 从 ESP32 设备接收按键说话（PTT）音频，调用语音识别将其转写，然后注入 Windows 当前输入框，或者驱动 Codex / Claude Code CLI 会话。
2. **ESP32 固件**（`firmware/` 目录）— 运行在 Zectrix S3 或 Waveshare S3 电子墨水屏开发板上。负责 Wi-Fi 连接、按键录音、设备端确认界面，并将 CLI 实时输出渲染到电子墨水屏上。

### 实际效果

按住设备上的按键，说出一条编程指令，松开按键，不到一秒钟，转写后的文字就会发送给 Claude Code 或 Codex。AI 代理的执行进度——调用了哪些工具、写了什么代码——实时回传并显示在电子墨水屏上。你的手还在键盘上；这个设备就是你 AI 编程助手的语音遥控器。

```
┌─────────────────────────────────────────────────┐
│  ESP32 电子墨水屏设备（局域网 Wi-Fi）              │
│  ┌──────┐   PTT 音频（PCM16 16kHz）              │
│  │ 麦克风 │──────────────────────────────────┐   │
│  └──────┘                                  ▼   │
│  ┌──────────┐   WebSocket        ┌──────────────┤
│  │ 电子墨水屏 │◄─── CLI 状态回传 ──│  主机桥接服务 │
│  └──────────┘                    └──────┬───────┘
└─────────────────────────────────────────┼───────┘
                                          │ 转写文本
                                          ▼
                              ┌───────────────────┐
                              │  Codex CLI  或    │
                              │  Claude Code CLI  │
                              └───────────────────┘
```

### 支持的硬件

| 开发板 | 屏幕 | 状态 |
|--------|------|------|
| [Zectrix S3 e-paper 4.2"](https://www.zectrix.ai/) | 400×300 灰度电子墨水 | ✅ 主要开发板 |
| Waveshare ESP32-S3 e-paper 1.54" | 200×200 黑白电子墨水 | ✅ 已支持 |

两款板子均采用 ESP32-S3，板载 MEMS 麦克风和按键。

### 功能特性

- 通过 WebSocket 接收 16kHz 单声道 PCM 音频
- 语音识别支持火山引擎闪速 ASR 或 OpenAI Whisper
- 通过剪贴板（Ctrl+V）注入 Windows 文本
- 托管 `codex exec --json` 会话
- 托管 `claude -p --output-format stream-json` 会话
- 将 CLI 状态、提示/回复摘要、日志末行、配额快照实时投影到电子墨水屏
- **多段语音累积** — 按住 BOOT 持续追加语音片段，UP 发送，DN 撤销上一段
- 设备端确认流程：先显示转写内容，主动操作后才发送
- UDP 局域网主机自动发现 — 设备自动找到桥接服务，无需写死 IP
- 发现回复和 WebSocket 握手均采用 HMAC-SHA256 签名认证
- NVS 持久化主机配对信息 — 重启后自动重连上次配对的服务器

---

### 第一部分 — 主机桥接服务

#### 环境要求

- Node.js 20 或更高版本
- Windows（文本注入功能需要；服务本身可在任何平台运行）
- Codex CLI 或 Claude Code CLI 已在 `PATH` 中（使用 CLI 会话模式时需要）
- 语音识别密钥（二选一）：
  - 火山引擎：`VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY`
  - OpenAI：`OPENAI_API_KEY`

#### 快速开始

**1. 安装**

推荐直接全局安装：

```powershell
npm install -g @mac20777/vibecoding-voice
```

如果你是在源码仓库里开发：

```powershell
npm install
```

**2. 配置**

```powershell
vibe config
```

首次运行 `vibe`、`vibe codex` 或 `vibe claude` 时，如果缺少语音识别密钥，会自动弹出这个配置向导。

向导会把用户级配置保存到：

- Windows：`%APPDATA%\vibecoding-voice\config.env`
- macOS：`~/Library/Application Support/vibecoding-voice/config.env`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/vibecoding-voice/config.env`

你仍然可以继续使用环境变量或当前目录下的 `.env` 文件；本地 `.env` 的优先级更高。

使用 Codex + 火山引擎的最简配置：

```env
STT_PROVIDER=volcengine
VOLCENGINE_APP_KEY=你的-app-key
VOLCENGINE_ACCESS_KEY=你的-access-key
TRANSCRIPT_DELIVERY_MODE=confirm_on_device
LAN_SHARED_SECRET=替换为一个足够长的随机密钥
```

`vibe codex`、`vibe claude` 和 `vibe` 会自动决定发送目标。只有你直接启动 `src/server.mjs` 时，才需要自己设置 `SEND_TARGET`。

**3. 启动**

```powershell
vibe codex
```

服务启动时会打印 WebSocket 地址和 UDP 发现地址。看到 `server ready` 即表示桥接服务已就绪。

**4. 诊断（可选）**

```powershell
vibe doctor
```

检查 CLI 工具、API 密钥、端口可用性和语音识别服务连通性。

#### 常用命令

| 命令 | 用途 |
|------|------|
| `vibe` | 以文本注入模式启动 |
| `vibe codex` | 以 Codex 模式启动桥接服务和控制台 |
| `vibe claude` | 以 Claude Code 模式启动桥接服务和控制台 |
| `vibe config` | 重新运行交互式配置/修复向导 |
| `vibe doctor` | 检查配置、密钥、CLI 和端口状态 |

#### 配置优先级

配置按以下顺序加载，后者覆盖前者：

1. 用户配置文件 `config.env`
2. 仓库根目录 `.env`
3. 当前工作目录 `.env`
4. 当前 shell 环境变量

也就是说，如果你当前项目目录里有 `.env`，它会覆盖通过 `vibe config` 保存的用户级配置。

#### 常见问题

- 提示 STT 未配置：
  运行 `vibe config`，填写火山引擎或 OpenAI 的密钥。
- 明明已经运行过 `vibe config`，但还是用了旧值：
  运行 `vibe doctor`，检查是不是被当前目录下的 `.env` 覆盖了。
- 想按项目使用不同配置：
  默认密钥放在用户级 `config.env` 里，只有少数项目再单独放本地 `.env`。

---

### 第二部分 — ESP32 固件

#### 方案 A：烧录预编译版本

从 [`firmware/releases/`](firmware/releases/) 下载最新的 zip 文件，解压后执行：

```powershell
# 将 COMx 替换为你的开发板串口号
python -m esptool --chip esp32s3 -p COMx -b 460800 write_flash "@flash_args"
```

#### 方案 B：从源码编译

需要 ESP-IDF v5.5。

```powershell
cd firmware
# Windows（自动检测 D:\Espressif 下的工具链）
.\build_windows.ps1 -Flash -Port COMx
```

#### 固件配置

固件默认已启用 UDP 自动发现。烧录前**必须**设置的只有共享密钥：

在 `firmware/sdkconfig` 中（或通过 `idf.py menuconfig → LAN Mic` 设置）：

```
CONFIG_LAN_SHARED_SECRET="你的密钥"
```

在主机桥接服务中设置相同的值即可，下面三种方式任选一种：

- 运行 `vibe config`
- 在本地 `.env` 中设置 `LAN_SHARED_SECRET`
- 在 shell 环境变量里设置 `LAN_SHARED_SECRET`

例如：

```env
LAN_SHARED_SECRET=你的密钥
```

> **安全提示**：密钥不要提交到 git。建议用 `openssl rand -hex 32` 生成一个随机十六进制字符串。

#### 首次开机

1. 开机。首次启动时设备自动进入 **Wi-Fi 配网 AP 模式**。
2. 电子墨水屏显示 AP 名称、密码和 `http://192.168.4.1`。
3. 用手机或电脑连接该热点，打开配网页面。
4. 填入家庭/办公 Wi-Fi 凭据并保存。
5. 设备重启，连上 Wi-Fi，通过 UDP 自动发现桥接服务，屏幕显示 **Ready**。

之后需要重新配网：同时按住 **UP + DOWN** 直到屏幕清除并重新进入 AP 模式。

#### 开发板注意事项

- 尽量使用 `firmware/build_windows.ps1` 里的烧录流程，这块板子的刷机后 reset 方式确实会影响行为。
- 如果你在验证“刷机后的第一次启动”，先不要急着连串口监视器。打开串口有可能额外触发一次 USB 重置，从而掩盖首启问题。
- 如果板子表现为“刚刷完不对，后来按 USB / reset 又正常”，先排查 reset 路径，不要第一时间怀疑重连逻辑。
- 更完整的 bring-up 踩坑和回归清单见 `CONTRIBUTING.md`。

---

### 设备按键说明

| 按键 | 连接状态 | 动作 |
|------|----------|------|
| 按住 BOOT | 已连接 | 录制一段语音 |
| BOOT（松开） | 等待确认 | 继续追加一段语音到当前转写 |
| BOOT（按下） | 已断连 | 强制立即重新连接 |
| UP 单击 | 等待确认 | 发送已累积的全部转写内容给 CLI |
| DN 单击 | 等待确认 | 撤销最后一段（只剩一段时取消全部） |
| 按住 UP + DN | 任意 | 重新进入 Wi-Fi 配网模式 |

有待发送内容时屏幕底部显示：`BOOT Add · UP Send · DN Undo`

---

### 配置项说明

#### 语音识别

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STT_PROVIDER` | 自动检测 | `volcengine` 或 `openai` |
| `VOLCENGINE_APP_KEY` | — | 火山引擎 App Key |
| `VOLCENGINE_ACCESS_KEY` | — | 火山引擎 Access Key |
| `VOLCENGINE_RESOURCE_ID` | `volc.bigasr.auc_turbo` | ASR 资源 ID |
| `VOLCENGINE_LANGUAGE` | `zh-CN` | 识别语言 |
| `OPENAI_API_KEY` | — | OpenAI API 密钥 |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | 转写模型 |
| `OPENAI_TRANSCRIBE_LANGUAGE` | — | 例如 `zh` |

#### 网络

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LAN_VOICE_PORT` | `8765` | WebSocket 端口 |
| `LAN_DISCOVERY_ENABLED` | `1` | 开启 UDP 自动发现 |
| `LAN_DISCOVERY_PORT` | `8766` | UDP 发现端口 |
| `LAN_DISCOVERY_HOST_ID` | — | 稳定主机标识（多桥接场景） |
| `LAN_SHARED_SECRET` | — | HMAC 认证密钥（**强烈建议设置**） |
| `LAN_AUTH_WINDOW_SEC` | `300` | 时间戳有效窗口（秒） |

#### 发送目标

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SEND_TARGET` | `text_injector` | `text_injector`、`codex_exec` 或 `claude_code` |
| `TRANSCRIPT_DELIVERY_MODE` | `immediate` | `immediate` 或 `confirm_on_device` |
| `TEXT_INJECTION_MODE` | `type_only` | `type_only` 或 `type_and_enter` |

#### CLI 会话

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEX_COMMAND` | `codex` | Codex CLI 路径 |
| `CODEX_CWD` | `.` | Codex 工作目录 |
| `CODEX_SKIP_GIT_REPO_CHECK` | — | 设为 `1` 传入 `--skip-git-repo-check` |
| `CLAUDE_COMMAND` | 自动检测 | Claude Code CLI 路径 |
| `CLAUDE_CWD` | 项目根目录 | Claude 工作目录 |
| `CLAUDE_ALLOWED_TOOLS` | `Read,Edit,Write,Bash,Glob,Grep` | 预授权工具列表 |
| `CLAUDE_MAX_TURNS` | `10` | 每次提示的最大轮数 |
| `CLI_TIMEOUT_SEC` | `300` | CLI 子进程超时秒数 |

#### 调试

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DRY_RUN_TEXT_INJECTION` | — | 设为 `1` 仅记录日志不注入按键 |
| `MOCK_TRANSCRIPT` | — | 固定转写文本，跳过语音识别 |
| `SAVE_DEBUG_WAV` | — | 设为 `1` 将每段音频保存到 `tmp/` |

---

### 开发调试

```powershell
npm test                             # 运行全部测试
node --test test/lan-auth.test.mjs   # 运行单个测试文件
node scripts/mock-client.mjs         # 模拟设备连接
```

调试工作流（源码模式）：`MOCK_TRANSCRIPT=你好世界 DRY_RUN_TEXT_INJECTION=1 node src/server.mjs`

---

### 安全与隐私

- `.env` 文件仅保留在本地，已加入 `.gitignore`，**绝不要提交**。
- 在共享或不受信任的局域网中必须设置 `LAN_SHARED_SECRET`。
- 音频会发送给配置的语音识别服务商，在敏感环境中使用前请确认服务商的数据留存和隐私政策。
- Codex 可能在 `~/.codex/` 下存储会话历史。
- 文本注入会临时使用剪贴板，操作完成后尽量恢复原有内容。
