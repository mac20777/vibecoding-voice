# vibecoding-voice

[English](#english) · [中文](#中文)

---

## English

`vibecoding-voice` is the host-side bridge for a LAN voice-coding setup built around an ESP32 device. It receives push-to-talk PCM audio over WebSocket, transcribes it with an STT provider, and then either:

- injects the transcript into the active Windows input field, or
- submits it to a managed Codex / Claude Code CLI session and streams the status back to the device UI.

The ESP32 firmware lives in a separate board project and speaks a small JSON + binary WebSocket protocol to this server.

### Features

- 16 kHz mono PCM ingest over WebSocket
- STT via Volcengine flash ASR or OpenAI Whisper
- optional Windows text injection via clipboard
- managed `codex exec --json` session bridge
- managed `claude -p --output-format stream-json` session bridge
- projected CLI status, summary, log tail, and quota snapshot for e-paper UI
- **multi-segment accumulation** — press BOOT to keep adding speech, UP to send, DN to undo the last segment
- device-side confirm flow: transcript shown first, explicit action required to send

### Requirements

- Node.js 20 or newer
- Windows (for text injection; the server itself runs anywhere)
- Codex CLI or Claude Code CLI on your `PATH` if you use the CLI session modes
- an STT provider key:
  - Volcengine `VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY`, or
  - `OPENAI_API_KEY`

### Quick Start

**1. Install dependencies**

```powershell
npm install
```

**2. Create a local config file**

```powershell
Copy-Item .env.example .env
```

**3. Edit `.env`** — common defaults for Codex + Volcengine:

```env
STT_PROVIDER=volcengine
VOLCENGINE_APP_KEY=your-app-key
VOLCENGINE_ACCESS_KEY=your-access-key
VOLCENGINE_RESOURCE_ID=volc.bigasr.auc_turbo
VOLCENGINE_LANGUAGE=zh-CN
LAN_VOICE_PORT=8765
LAN_DISCOVERY_ENABLED=1
LAN_DISCOVERY_PORT=8766
LAN_SHARED_SECRET=replace-with-a-random-secret
SEND_TARGET=codex_exec
TRANSCRIPT_DELIVERY_MODE=confirm_on_device
CODEX_COMMAND=codex
CODEX_CWD=.
```

**4. Start the bridge**

```powershell
npm start
```

**5. Connect the device** — point firmware at:

```
ws://<your-lan-ip>:8765
```

**6. Set the same `LAN_SHARED_SECRET`** in the device firmware local config before flashing. Never commit the secret.

### Device Usage

| Button | State | Action |
|--------|-------|--------|
| Hold BOOT | Any | Record a speech segment |
| BOOT (release) | Awaiting | Append another speech segment to the pending transcript |
| UP | Awaiting | Send the accumulated transcript |
| DN | Awaiting | Undo the last speech segment (or cancel all if only one) |

The footer on the device screen shows `BOOT Add | UP Send | DN Undo` when a transcript is waiting.

### Device Wi-Fi Setup

- First boot: the device enters config AP mode automatically.
- The screen shows the AP SSID, password, and `http://192.168.4.1`.
- Connect to that AP and open `http://192.168.4.1` to save Wi-Fi credentials.
- To re-enter config mode later: hold `UP + DOWN` until the device clears saved Wi-Fi.
- The config AP uses WPA/WPA2; the password is derived from the device identity and shown on screen.

### Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PROVIDER` | auto-detect | `volcengine` or `openai` |
| `VOLCENGINE_APP_KEY` | — | Volcengine app key |
| `VOLCENGINE_ACCESS_KEY` | — | Volcengine access key |
| `VOLCENGINE_RESOURCE_ID` | `volc.bigasr.auc_turbo` | ASR resource |
| `VOLCENGINE_LANGUAGE` | `zh-CN` | Recognition language |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Transcription model |
| `OPENAI_TRANSCRIBE_LANGUAGE` | — | e.g. `zh` |
| `LAN_VOICE_PORT` | `8765` | WebSocket port |
| `LAN_DISCOVERY_ENABLED` | `1` | Enable UDP discovery |
| `LAN_DISCOVERY_PORT` | `8766` | UDP discovery port |
| `LAN_DISCOVERY_HOST_ID` | — | Stable host ID (multi-bridge LAN) |
| `LAN_SHARED_SECRET` | — | HMAC auth secret (strongly recommended) |
| `LAN_AUTH_WINDOW_SEC` | `300` | Timestamp freshness window (seconds) |
| `SEND_TARGET` | `text_injector` | `text_injector`, `codex_exec`, or `claude_code` |
| `TRANSCRIPT_DELIVERY_MODE` | `immediate` | `immediate` or `confirm_on_device` |
| `TEXT_INJECTION_MODE` | `type_only` | `type_only` or `type_and_enter` |
| `CODEX_COMMAND` | `codex` | Codex CLI path |
| `CODEX_CWD` | `.` | Working directory for Codex |
| `CODEX_SKIP_GIT_REPO_CHECK` | — | Set `1` to pass `--skip-git-repo-check` |
| `CLAUDE_COMMAND` | auto-detect | Claude Code CLI path |
| `CLAUDE_CWD` | project root | Working directory for Claude |
| `CLAUDE_ALLOWED_TOOLS` | `Read,Edit,Write,Bash,Glob,Grep` | Pre-approved tools |
| `CLAUDE_MAX_TURNS` | `10` | Max agentic turns per prompt |
| `CLI_TIMEOUT_SEC` | `300` | Kill CLI subprocess after N seconds |
| `DRY_RUN_TEXT_INJECTION` | — | Set `1` to log without keystrokes |
| `MOCK_TRANSCRIPT` | — | Fixed transcript text, bypasses STT |
| `SAVE_DEBUG_WAV` | — | Set `1` to save segments to `tmp/` |

### LAN Host Discovery

The bridge advertises itself over UDP so the device does not need a hardcoded host IP.

- Host listens on `LAN_DISCOVERY_PORT` for `discover_host` broadcasts.
- Device sends a broadcast and receives a reply with the current WebSocket URL.
- Set `LAN_DISCOVERY_HOST_ID` on both sides if you run more than one bridge on the same LAN.
- If `LAN_SHARED_SECRET` is configured, discovery replies and `hello` messages are HMAC-SHA256 signed.

### Development

```powershell
npm test                  # run all tests
node --test test/lan-auth.test.mjs  # run a single test
node scripts/mock-client.mjs        # simulate a device connection
```

Debug flags: `MOCK_TRANSCRIPT=hello world` · `DRY_RUN_TEXT_INJECTION=1` · `SAVE_DEBUG_WAV=1`

Diagnostics: `npm run doctor`

### Security and Privacy

- Keep `.env` local — it is git-ignored and must never be committed.
- Always set `LAN_SHARED_SECRET` on a shared or untrusted LAN.
- Audio is sent to the configured STT provider; review provider retention and privacy settings before public use.
- Codex may store session history under `~/.codex/`.
- Text injection temporarily uses the clipboard and restores its previous contents when possible.

---

## 中文

`vibecoding-voice` 是一套基于 ESP32 设备的 LAN 语音编程桥接服务，运行在主机端。它通过 WebSocket 接收按键说话（Push-to-Talk）的 PCM 音频，调用语音识别服务转写，然后：

- 将识别结果注入 Windows 当前输入框，或
- 发送给托管的 Codex / Claude Code CLI 会话，并将状态实时投影回设备屏幕。

ESP32 固件在另一个板级项目中维护，通过简单的 JSON + 二进制 WebSocket 协议与本服务通信。

### 功能特性

- 通过 WebSocket 接收 16kHz 单声道 PCM 音频
- 语音识别支持火山引擎闪速 ASR 或 OpenAI Whisper
- 可选通过剪贴板注入 Windows 文本
- 托管 `codex exec --json` 会话
- 托管 `claude -p --output-format stream-json` 会话
- 将 CLI 状态、摘要、日志末行、配额快照投影到设备电子墨水屏
- **多段语音累积** — 按 BOOT 持续追加语音片段，UP 发送，DN 撤销上一段
- 设备端确认流程：先显示转写内容，需主动操作才发送

### 环境要求

- Node.js 20 或更高版本
- Windows（文本注入功能需要；服务本身可在任何平台运行）
- Codex CLI 或 Claude Code CLI 已在 `PATH` 中（使用 CLI 会话模式时）
- 语音识别密钥（二选一）：
  - 火山引擎：`VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY`
  - OpenAI：`OPENAI_API_KEY`

### 快速开始

**1. 安装依赖**

```powershell
npm install
```

**2. 创建本地配置文件**

```powershell
Copy-Item .env.example .env
```

**3. 编辑 `.env`** — 以 Codex + 火山引擎为例的常用配置：

```env
STT_PROVIDER=volcengine
VOLCENGINE_APP_KEY=你的-app-key
VOLCENGINE_ACCESS_KEY=你的-access-key
VOLCENGINE_RESOURCE_ID=volc.bigasr.auc_turbo
VOLCENGINE_LANGUAGE=zh-CN
LAN_VOICE_PORT=8765
LAN_DISCOVERY_ENABLED=1
LAN_DISCOVERY_PORT=8766
LAN_SHARED_SECRET=替换为随机密钥
SEND_TARGET=codex_exec
TRANSCRIPT_DELIVERY_MODE=confirm_on_device
CODEX_COMMAND=codex
CODEX_CWD=.
```

**4. 启动桥接服务**

```powershell
npm start
```

**5. 连接设备** — 将固件的 WebSocket 地址指向：

```
ws://<主机局域网IP>:8765
```

**6. 在设备固件本地配置中设置相同的 `LAN_SHARED_SECRET`**，然后再烧录。密钥不要提交到 git。

### 设备操作说明

| 按键 | 状态 | 动作 |
|------|------|------|
| 按住 BOOT | 任意 | 录制一段语音 |
| BOOT（松开后） | 等待确认 | 继续追加一段语音到当前转写 |
| UP | 等待确认 | 发送已累积的全部转写内容 |
| DN | 等待确认 | 撤销最后一段语音（只剩一段时则取消全部） |

设备屏幕底部在有待发送内容时显示：`BOOT Add | UP Send | DN Undo`

### 设备 Wi-Fi 配网

- 首次开机：设备自动进入配网 AP 模式。
- 屏幕显示 AP 名称、密码和 `http://192.168.4.1`。
- 用手机或电脑连接该 AP，打开 `http://192.168.4.1` 保存 Wi-Fi 凭据。
- 之后需要重新配网：同时按住 `UP + DOWN` 直到设备清除保存的 Wi-Fi 并重新进入 AP 模式。
- 配网 AP 使用 WPA/WPA2，密码由设备标识派生并显示在屏幕上。

### 配置项说明

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
| `LAN_VOICE_PORT` | `8765` | WebSocket 端口 |
| `LAN_DISCOVERY_ENABLED` | `1` | 开启 UDP 自动发现 |
| `LAN_DISCOVERY_PORT` | `8766` | UDP 发现端口 |
| `LAN_DISCOVERY_HOST_ID` | — | 稳定主机标识（多桥接场景） |
| `LAN_SHARED_SECRET` | — | HMAC 认证密钥（强烈建议设置） |
| `LAN_AUTH_WINDOW_SEC` | `300` | 时间戳有效窗口（秒） |
| `SEND_TARGET` | `text_injector` | `text_injector`、`codex_exec` 或 `claude_code` |
| `TRANSCRIPT_DELIVERY_MODE` | `immediate` | `immediate` 或 `confirm_on_device` |
| `TEXT_INJECTION_MODE` | `type_only` | `type_only` 或 `type_and_enter` |
| `CODEX_COMMAND` | `codex` | Codex CLI 路径 |
| `CODEX_CWD` | `.` | Codex 工作目录 |
| `CODEX_SKIP_GIT_REPO_CHECK` | — | 设为 `1` 传入 `--skip-git-repo-check` |
| `CLAUDE_COMMAND` | 自动检测 | Claude Code CLI 路径 |
| `CLAUDE_CWD` | 项目根目录 | Claude 工作目录 |
| `CLAUDE_ALLOWED_TOOLS` | `Read,Edit,Write,Bash,Glob,Grep` | 预授权工具列表 |
| `CLAUDE_MAX_TURNS` | `10` | 每次提示的最大轮数 |
| `CLI_TIMEOUT_SEC` | `300` | CLI 子进程超时秒数 |
| `DRY_RUN_TEXT_INJECTION` | — | 设为 `1` 仅记录日志不注入按键 |
| `MOCK_TRANSCRIPT` | — | 固定转写文本，跳过语音识别 |
| `SAVE_DEBUG_WAV` | — | 设为 `1` 将每段音频保存到 `tmp/` |

### LAN 主机自动发现

桥接服务通过 UDP 广播自我通告，设备无需写死主机 IP。

- 主机在 `LAN_DISCOVERY_PORT` 监听 `discover_host` 广播。
- 设备发出广播后收到含当前 WebSocket 地址的回复。
- 同一局域网有多个桥接实例时，在两端设置相同的 `LAN_DISCOVERY_HOST_ID`。
- 配置了 `LAN_SHARED_SECRET` 时，发现回复和 `hello` 消息均用 HMAC-SHA256 签名。

### 开发调试

```powershell
npm test                  # 运行全部测试
node --test test/lan-auth.test.mjs  # 运行单个测试
node scripts/mock-client.mjs        # 模拟设备连接
```

调试开关：`MOCK_TRANSCRIPT=你好世界` · `DRY_RUN_TEXT_INJECTION=1` · `SAVE_DEBUG_WAV=1`

环境诊断：`npm run doctor`

### 安全与隐私

- `.env` 文件仅保留在本地，已加入 `.gitignore`，绝不要提交。
- 在共享或不受信任的局域网中必须设置 `LAN_SHARED_SECRET`。
- 音频会发送给配置的语音识别服务商，公开演示或团队使用前请确认服务商的数据留存和隐私政策。
- Codex 可能在 `~/.codex/` 下存储会话历史。
- 文本注入会临时使用剪贴板，操作完成后尽量恢复原有剪贴板内容。
