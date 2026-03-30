# vibecoding-voice

局域网语音输入 MVP。

这套程序做三件事：

1. 接收 ESP32 板子通过 WebSocket 发送的 `PTT + PCM` 音频段
2. 调用 STT 把音频转成文字
3. 把转写文本注入到当前焦点输入框，等效于键盘输入

## Quick Start

1. 安装依赖

```powershell
npm install
```

2. 设置环境变量

```powershell
$env:STT_PROVIDER = "volcengine"
$env:VOLCENGINE_APP_KEY = "你的 App Key"
$env:VOLCENGINE_ACCESS_KEY = "你的 Access Key"
$env:VOLCENGINE_RESOURCE_ID = "volc.bigasr.auc_turbo"
$env:VOLCENGINE_LANGUAGE = "zh-CN"
$env:LAN_VOICE_BIND = "0.0.0.0"
$env:LAN_VOICE_PORT = "8765"
$env:TRANSCRIPT_DELIVERY_MODE = "confirm_on_device"
$env:TEXT_INJECTION_MODE = "type_only"
```

3. 启动服务

```powershell
npm start
```

4. 把板子端 WebSocket 指向：

```text
ws://<你的电脑局域网IP>:8765
```

## Environment

- `STT_PROVIDER`: `volcengine` 或 `openai`。不填时按已配置的 key 自动判断。
- `VOLCENGINE_APP_KEY`: 火山引擎 App Key
- `VOLCENGINE_ACCESS_KEY`: 火山引擎 Access Key
- `VOLCENGINE_RESOURCE_ID`: 默认 `volc.bigasr.auc_turbo`
- `VOLCENGINE_LANGUAGE`: 默认 `zh-CN`
- `OPENAI_API_KEY`: OpenAI API key。作为备用 provider 保留。
- `OPENAI_TRANSCRIBE_MODEL`: 默认 `whisper-1`
- `OPENAI_TRANSCRIBE_LANGUAGE`: 可选，如 `zh`
- `LAN_VOICE_BIND`: 默认 `0.0.0.0`
- `LAN_VOICE_PORT`: 默认 `8765`
- `TRANSCRIPT_DELIVERY_MODE`: `immediate` 或 `confirm_on_device`
- `TEXT_INJECTION_MODE`: `type_only` 或 `type_and_enter`
- `DRY_RUN_TEXT_INJECTION`: 设为 `1` 时只打印转写结果，不真正发送粘贴按键
- `MOCK_TRANSCRIPT`: 设置后跳过 STT，直接把该文本注入输入框
- `SAVE_DEBUG_WAV`: 设为 `1` 时保存每段音频到 `tmp/`

## Notes

- Windows 文本注入默认会临时覆盖文本剪贴板，然后发送一次 `Ctrl+V`，结束后恢复文本剪贴板。
- 这是 MVP，不做持续对话，只做 `PTT` 一段一转写。
- 当前火山接的是“录音文件极速版识别”接口：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`。官方文档：<https://www.volcengine.com/docs/6561/1631584?lang=zh>
- 如果后面要做到“边说边出字”，再把 STT provider 升级为火山“大模型流式语音识别 API”：<https://www.volcengine.com/docs/6561/1354869?lang=zh>
- `confirm_on_device` 模式下，板子会先显示转写结果，再用 `UP` 发送、`DOWN` 撤销。
