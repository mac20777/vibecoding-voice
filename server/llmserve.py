#!/usr/bin/env python3
"""
llmserve.py - WebSocket 服务，接收 ESP32 音频流，调用百炼 ASR + LLM 流式返回

协议:
  上行: {"type": "ptt_start", "device_id": "..."}
        Binary PCM16 16kHz 音频块
        {"type": "ptt_stop", "duration_ms": 3200}
  下行: {"type": "asr_interim", "text": "..."}
        {"type": "asr_final", "text": "...", "request_id": "..."}
        {"type": "llm_chunk", "text": "..."}
        {"type": "llm_done", "full_text": "...", "usage": {...}}
        {"type": "error", "message": "..."}

启动: DASHSCOPE_API_KEY=sk-xxx python3 llmserve.py
"""

import asyncio
import json
import logging
import os
import socket
import struct
import sys
import threading
import time
import wave
import hmac
import hashlib
import requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import dashscope
import websockets
from dashscope.audio.asr import Recognition, RecognitionCallback

# ─── 配置 ───────────────────────────────────────────────
HOST = os.getenv("LISTEN_HOST", "0.0.0.0")
PORT = int(os.getenv("LISTEN_PORT", "8765"))
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
ASR_MODEL = os.getenv("ASR_MODEL", "fun-asr-realtime")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen-plus")
CHUNK_SIZE = 3200  # 每次发送 3200 bytes 给 ASR (100ms @ 16kHz 16bit mono)
SAVE_DEBUG_WAV = os.getenv("SAVE_DEBUG_WAV", "0") == "1"
ENABLE_SEARCH = os.getenv("LLM_ENABLE_SEARCH", "1") == "1"  # 默认开启联网搜索
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "你是一个简洁的语音助手。请用简短的中文回答，控制在100字以内。",
)
MAX_CONVERSATION_TURNS = 5  # 最多保留 5 轮对话 (10 条消息)
# ─── TTS 配置 ───────────────────────────────────────────────
TTS_ENABLED = os.getenv("TTS_ENABLED", "1") == "1"
TTS_MODEL = os.getenv("TTS_MODEL", "qwen-tts")  # qwen-tts / cosyvoice-v2
TTS_VOICE = os.getenv("TTS_VOICE", "Cherry")  # Cherry 音色
TTS_SAMPLE_RATE = 16000  # 设备期望的采样率
TTS_FORMAT = "pcm"  # PCM16 格式，设备直接播放
# ─── UDP Discovery 配置 ─────────────────────────────────
DISCOVERY_PORT = int(os.getenv("DISCOVERY_PORT", "8766"))
DISCOVERY_SERVICE = os.getenv("DISCOVERY_SERVICE", "vibecoding-voice")
LAN_SHARED_SECRET = os.getenv("LAN_SHARED_SECRET", "")
DISCOVERY_HOST_ID = os.getenv("DISCOVERY_HOST_ID", "")


# ─── 日志 ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("llmserve")

# ─── 全局状态 ───────────────────────────────────────────
_loop = None  # asyncio 事件循环引用
_executor = ThreadPoolExecutor(max_workers=4)  # LLM 调用线程池


# ─── ASR 回调 ──────────────────────────────────────────
class AsrCallback(RecognitionCallback):
    """ASR 回调，将结果转发到 WebSocket"""

    def __init__(self, ws, event_loop, session_info):
        self.ws = ws
        self.loop = event_loop
        self.session = session_info
        self.final_text = ""
        self.is_final = False

    def on_open(self):
        logger.info("[%s] ASR 连接已打开", self.session["device_id"])

    def on_complete(self):
        logger.info("[%s] ASR 完成, 最终文本: '%s'", self.session["device_id"], self.final_text)
        self.is_final = True
        # 如果还没发过 asr_final，在这里补发
        if not self.session.get("asr_final_sent"):
            self._send_asr_final(self.final_text)

    def on_error(self, result):
        err_msg = getattr(result, "message", "unknown")
        err_code = getattr(result, "code", "unknown")
        logger.error("[%s] ASR 错误: code=%s, msg=%s", self.session["device_id"], err_code, err_msg)
        self._send_error(f"ASR failed: {err_code} - {err_msg}")

    def on_close(self):
        logger.info("[%s] ASR 连接已关闭", self.session["device_id"])

    def on_event(self, result):
        sentence = result.get_sentence()
        if sentence is None:
            return
        text = sentence.get("text", "")
        is_end = RecognitionResult.is_sentence_end(sentence) if hasattr(RecognitionResult, 'is_sentence_end') else (sentence.get("end_time") is not None)
        
        # 用 SDK 自带的方法判断
        try:
            is_end = RecognitionResult.is_sentence_end(sentence)
        except Exception:
            is_end = sentence.get("end_time") is not None

        if text:
            if is_end:
                self.final_text = text
                self._send_asr_final(text)
            else:
                self._send_asr_interim(text)

    def _send_asr_interim(self, text):
        msg = json.dumps({"type": "asr_interim", "text": text}, ensure_ascii=False)
        asyncio.run_coroutine_threadsafe(self.ws.send(msg), self.loop)

    def _send_asr_final(self, text):
        if self.session.get("asr_final_sent"):
            return
        self.session["asr_final_sent"] = True
        msg = json.dumps(
            {
                "type": "asr_final",
                "text": text,
                "request_id": getattr(self, "request_id", ""),
            },
            ensure_ascii=False,
        )
        asyncio.run_coroutine_threadsafe(self.ws.send(msg), self.loop)

    def _send_error(self, message):
        msg = json.dumps({"type": "error", "message": message}, ensure_ascii=False)
        asyncio.run_coroutine_threadsafe(self.ws.send(msg), self.loop)


# 需要导入 RecognitionResult
from dashscope.audio.asr.recognition import RecognitionResult


# ─── 业务逻辑 ───────────────────────────────────────────
async def handle_ptt_cycle(ws, audio_data, session, event_loop):
    """处理一次完整的 PTT 循环: ASR → LLM → 流式返回"""
    device_id = session["device_id"]
    start_time = time.time()

    if not audio_data:
        logger.warning("[%s] 音频数据为空，跳过", device_id)
        await ws.send(json.dumps({"type": "error", "message": "empty audio"}, ensure_ascii=False))
        return

    logger.info("[%s] 收到音频 %d bytes (%.1fs)，开始 ASR...", device_id, len(audio_data), len(audio_data) / 32000.0)

    # ── 保存调试 WAV ──
    if SAVE_DEBUG_WAV:
        save_debug_wav(audio_data, device_id)

    # ── ASR 识别 ──
    asr_text = await run_asr(ws, audio_data, session, event_loop)
    asr_time = time.time() - start_time
    logger.info("[%s] ASR 耗时 %.2fs，结果: '%s'", device_id, asr_time, asr_text)

    if not asr_text or not asr_text.strip():
        logger.warning("[%s] ASR 结果为空", device_id)
        await ws.send(json.dumps({"type": "error", "message": "ASR returned empty text"}, ensure_ascii=False))
        return

    # ── LLM 对话 ──
    llm_start = time.time()
    full_text = await run_llm_stream(ws, asr_text, session)
    llm_time = time.time() - llm_start
    total_time = time.time() - start_time

    logger.info("[%s] LLM 耗时 %.2fs，总耗时 %.2fs", device_id, llm_time, total_time)
    logger.info("[%s] 完整回复: '%s'", device_id, full_text[:100])

    # ── TTS 语音播报 ──
    if TTS_ENABLED:
        await _send_tts_to_device(ws, full_text)

    # ── 发送结束状态 (适配旧协议) ──
    # 只发 cli_summary，不发 cli_session_state: idle
    # 原因: cli_session_state idle 会触发 ShowIdleTodoPage()，清空对话内容
    final_summary = json.dumps(
        {"type": "cli_summary", "latestAssistantText": full_text, "done": True},
        ensure_ascii=False,
    )
    await ws.send(final_summary)


def save_debug_wav(audio_data, device_id):
    """保存原始 PCM 为 WAV 文件用于调试"""
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"/tmp/debug_{device_id.replace(':', '')}_{ts}.wav"
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(16000)
            wf.writeframes(audio_data)
        logger.info("[%s] 调试 WAV 已保存: %s", device_id, filename)
    except Exception as e:
        logger.warning("[%s] 保存调试 WAV 失败: %s", device_id, e)


def _tts_synthesize(text):
    """调用百炼 qwen-tts API，返回 PCM16 16kHz 音频字节。

    qwen-tts 返回 WAV 格式(24kHz)，需重采样到 16kHz。
    返回: (pcm_data: bytes, sample_rate: int) 或 (None, 0) 失败
    """
    if not text or not text.strip():
        return None, 0

    try:
        from dashscope.audio.qwen_tts import SpeechSynthesizer
        import io
        import wave as wave_module

        resp = SpeechSynthesizer.call(
            model="qwen-tts",
            text=text,
            voice=TTS_VOICE,
        )

        if resp.status_code != 200:
            logger.error("TTS API error: %s %s", resp.status_code, resp.get("message", ""))
            return None, 0

        audio_url = resp.get("output", {}).get("audio", {}).get("url", "")
        if not audio_url:
            logger.error("TTS response missing audio URL")
            return None, 0

        # 下载 WAV
        wav_data = requests.get(audio_url, timeout=30).content
        logger.info("TTS WAV downloaded: %d bytes from OSS", len(wav_data))

        # WAV → PCM + 重采样 24k → 16k
        wf = wave_module.open(io.BytesIO(wav_data), "rb")
        src_rate = wf.getframerate()  # 24000
        src_width = wf.getsampwidth()  # 2 (16-bit)
        src_channels = wf.getnchannels()  # 1
        src_frames = wf.readframes(wf.getnframes())
        wf.close()

        logger.info("TTS source: %dHz, %dch, %d-bit, %d samples",
                     src_rate, src_channels, src_width * 8, len(src_frames) // src_width)

        # 简单线性重采样: 24000 → 16000 = 每 3 个采样保留 2 个
        if src_rate == 24000 and src_channels == 1:
            samples_24k = struct.unpack(f"<{len(src_frames) // 2}h", src_frames)
            samples_16k = []
            for i in range(0, len(samples_24k) * 2 // 3):
                src_idx = i * 3 // 2
                samples_16k.append(samples_24k[src_idx])
            pcm_data = struct.pack(f"<{len(samples_16k)}h", *samples_16k)
            logger.info("TTS resampled 24k→16k: %d bytes (%d samples)", len(pcm_data), len(pcm_data) // 2)
        else:
            # 如果已经是 16kHz 单声道，直接用
            if src_rate == 16000 and src_channels == 1:
                pcm_data = src_frames
            else:
                logger.warning("Unexpected audio format: %dHz, %dch", src_rate, src_channels)
                return None, 0

        return pcm_data, 16000

    except Exception as e:
        logger.error("TTS request failed: %s", e, exc_info=True)
        return None, 0


async def _send_tts_to_device(ws, full_text):
    """将 TTS 合成的音频发送给设备。

    二进制帧格式: 2字节header长度(BE) + JSON头 + PCM16音频数据
    """
    if not TTS_ENABLED or not full_text:
        return

    logger.info("TTS 合成中: '%s'...", full_text[:30])

    # 同步调用 TTS，放在线程池中
    pcm_data, sample_rate = await asyncio.get_event_loop().run_in_executor(
        _executor, _tts_synthesize, full_text
    )

    if not pcm_data:
        logger.warning("TTS 合成失败，跳过音频推送")
        return

    # 构建二进制帧
    json_header = json.dumps({
        "type": "tts_audio",
        "format": "pcm16",
        "sample_rate": sample_rate,
    }, ensure_ascii=False).encode("utf-8")

    header_len = len(json_header)
    # 2字节大端序 + JSON头 + PCM数据
    frame = struct.pack(">H", header_len) + json_header + pcm_data

    # 直接发送完整帧（不分块，设备期望每帧包含完整header）
    await ws.send(frame)

    logger.info("TTS 音频已推送: %d 字节 PCM, 总帧 %d 字节", len(pcm_data), len(frame))


async def run_asr(ws, audio_data, session, event_loop):
    """调用百炼 ASR 实时识别，返回最终文本"""
    device_id = session["device_id"]
    session["asr_final_sent"] = False
    result_holder = {"text": "", "done": False, "error": None}

    class LocalAsrCallback(RecognitionCallback):
        def on_open(self):
            logger.debug("[%s] ASR on_open", device_id)

        def on_complete(self):
            logger.debug("[%s] ASR on_complete", device_id)
            result_holder["done"] = True

        def on_error(self, result):
            err = f"{getattr(result, 'code', '?')}: {getattr(result, 'message', '?')}"
            logger.error("[%s] ASR on_error: %s", device_id, err)
            result_holder["error"] = err
            result_holder["done"] = True

        def on_close(self):
            logger.debug("[%s] ASR on_close", device_id)

        def on_event(self, result):
            sentence = result.get_sentence()
            if sentence is None:
                return
            text = sentence.get("text", "")
            is_end = RecognitionResult.is_sentence_end(sentence)

            if not text:
                return

            # 转发到 WebSocket (适配旧协议)
            if is_end:
                result_holder["text"] = text
                # 发送 transcript_final 代替 asr_final
                msg = json.dumps({"type": "transcript_final", "text": text}, ensure_ascii=False)
                asyncio.run_coroutine_threadsafe(ws.send(msg), event_loop)
                # 发送 cli_state 表示正在运行 LLM
                state_msg = json.dumps({"type": "cli_session_state", "phase": "running"}, ensure_ascii=False)
                asyncio.run_coroutine_threadsafe(ws.send(state_msg), event_loop)

    callback = LocalAsrCallback()
    recognizer = Recognition(
        model=ASR_MODEL,
        callback=callback,
        format="pcm",
        sample_rate=16000,
    )

    # 在后台线程运行 ASR (SDK 内部使用阻塞调用)
    def _run_asr_sync():
        try:
            recognizer.start()
            # 分块发送音频
            for i in range(0, len(audio_data), CHUNK_SIZE):
                chunk = audio_data[i : i + CHUNK_SIZE]
                recognizer.send_audio_frame(chunk)
            recognizer.stop()
        except Exception as e:
            logger.error("[%s] ASR 异常: %s", device_id, e)
            result_holder["error"] = str(e)
            result_holder["done"] = True

    thread = threading.Thread(target=_run_asr_sync, daemon=True)
    thread.start()

    # 等待 ASR 完成 (最多 30 秒超时)
    timeout = 30
    waited = 0
    while not result_holder["done"] and waited < timeout:
        await asyncio.sleep(0.1)
        waited += 0.1

    if result_holder["error"]:
        raise Exception(f"ASR error: {result_holder['error']}")

    if not result_holder["done"]:
        logger.warning("[%s] ASR 超时", device_id)
        session["asr_final_sent"] = True

    return result_holder["text"]


def _build_messages(user_text, conversation_history):
    """构建 LLM 消息列表: system prompt + 历史 (最多5轮) + 当前问题"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    # 只保留最近 MAX_CONVERSATION_TURNS 轮
    recent_turns = conversation_history[-MAX_CONVERSATION_TURNS:]
    for user_msg, assistant_msg in recent_turns:
        messages.append({"role": "user", "content": user_msg})
        messages.append({"role": "assistant", "content": assistant_msg})
    
    messages.append({"role": "user", "content": user_text})
    return messages


async def run_llm_stream(ws, user_text, session):
    """调用 LLM 流式输出，逐 chunk 发送到 WebSocket"""
    device_id = session["device_id"]
    conversation_history = session.get("conversation_history", [])
    messages = _build_messages(user_text, conversation_history)

    full_text = ""
    chunk_index = 0

    # LLM 调用是同步的，放在线程池中执行
    def _call_llm():
        responses = dashscope.Generation.call(
            api_key=DASHSCOPE_API_KEY,
            model=LLM_MODEL,
            messages=messages,
            stream=True,
            incremental_output=True,
            result_format="message",
            enable_search=ENABLE_SEARCH,
        )
        return responses

    responses = await asyncio.get_event_loop().run_in_executor(_executor, _call_llm)

    for response in responses:
        if response.status_code != 200:
            logger.error(
                "[%s] LLM 错误: code=%s, msg=%s",
                device_id,
                response.code,
                response.message,
            )
            continue

        try:
            content = response.output.choices[0].message.content
        except (AttributeError, IndexError, KeyError) as e:
            logger.warning("[%s] LLM 响应解析异常: %s", device_id, e)
            continue

        if content:
            full_text += content
            chunk_index += 1
            
            # 适配旧协议: 发送 cli_summary 代替 llm_chunk
            # 墨水屏刷新慢，限制发送频率 (每 0.3s 或每 3 个 chunk 发送一次)
            if chunk_index % 3 == 0:
                summary_msg = json.dumps(
                    {"type": "cli_summary", "latestAssistantText": full_text},
                    ensure_ascii=False,
                )
                await ws.send(summary_msg)

    # 保存本轮对话到历史
    conversation_history.append((user_text, full_text))
    session["conversation_history"] = conversation_history
    logger.info("[%s] 对话历史: %d 轮", device_id, len(conversation_history))

    session["llm_full_text"] = full_text
    return full_text


async def handle_client(websocket):
    """处理单个 WebSocket 客户端连接"""
    session = {
        "device_id": "unknown",
        "authenticated": False,
        "recording": False,
        "audio_buffer": b"",
        "asr_final_sent": False,
        "llm_full_text": "",
        "conversation_history": [],  # 多轮对话历史 [(user_text, assistant_text), ...]
    }
    remote = websocket.remote_address if hasattr(websocket, 'remote_address') else "?"
    logger.info("客户端连接: %s", remote)

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                # 二进制音频数据
                if session["recording"]:
                    session["audio_buffer"] += message
                    logger.debug(
                        "[%s] 收到音频块 %d bytes (累计 %d)",
                        session["device_id"],
                        len(message),
                        len(session["audio_buffer"]),
                    )
                continue

            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except json.JSONDecodeError:
                    logger.warning("无效 JSON: %s", message[:100])
                    continue

                msg_type = data.get("type", "")
                logger.info("[%s] 收到消息: %s", session["device_id"], msg_type)

                if msg_type == "ptt_start":
                    session["device_id"] = data.get("device_id", session["device_id"])
                    session["recording"] = True
                    session["audio_buffer"] = b""
                    session["asr_final_sent"] = False
                    session["llm_full_text"] = ""
                    logger.info(
                        "[%s] 开始录音 (PTT)",
                        session["device_id"],
                    )
                    await websocket.send(
                        json.dumps({"type": "status", "status": "recording"}, ensure_ascii=False)
                    )

                elif msg_type == "ptt_stop":
                    session["recording"] = False
                    duration_ms = data.get("duration_ms", 0)
                    logger.info(
                        "[%s] 录音结束，时长 %dms, 音频 %d bytes",
                        session["device_id"],
                        duration_ms,
                        len(session["audio_buffer"]),
                    )

                    audio_data = session["audio_buffer"]
                    session["audio_buffer"] = b""

                    await websocket.send(
                        json.dumps({"type": "status", "status": "processing"}, ensure_ascii=False)
                    )

                    await handle_ptt_cycle(
                        websocket, audio_data, session, asyncio.get_event_loop()
                    )

                elif msg_type == "hello":
                    session["device_id"] = data.get("device_id", "unknown")
                    session["authenticated"] = True
                    logger.info("[%s] Hello 握手成功", session["device_id"])
                    await websocket.send(
                        json.dumps(
                            {"type": "hello_ack", "device_id": session["device_id"]},
                            ensure_ascii=False,
                        )
                    )
                    await websocket.send(
                        json.dumps({"type": "server_ready", "status": "ready"}, ensure_ascii=False)
                    )

                elif msg_type == "ping":
                    await websocket.send(
                        json.dumps({"type": "pong", "now_ms": int(time.time() * 1000)}, ensure_ascii=False)
                    )

                else:
                    logger.warning("[%s] 未知消息类型: %s", session["device_id"], msg_type)

    except websockets.exceptions.ConnectionClosed:
        logger.info("[%s] 连接已关闭", session["device_id"])
    except Exception as e:
        logger.error("[%s] 处理异常: %s", session["device_id"], e, exc_info=True)
        try:
            await websocket.send(
                json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False)
            )
        except Exception:
            pass



# ─── 局域网 IP 获取 ─────────────────────────────────────
def get_local_lan_ip():
    """获取本机局域网 IP 地址 (非 127.0.0.1)"""
    # 方法1: 通过 socket 连接外部地址获取
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip != "127.0.0.1":
            return ip
    except Exception:
        pass

    # 方法2: 遍历网络接口
    try:
        import fcntl
        import struct as st
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for i in range(1, 100):
            iface = f"eth{i}" if i > 0 else "eth0"
            try:
                ip_bytes = fcntl.ioctl(
                    s.fileno(),
                    0x8915,  # SIOCGIFADDR
                    struct.pack("256s", iface.encode("utf-8")[:15])
                )
                ip = socket.inet_ntoa(ip_bytes[20:24])
                if ip and ip != "127.0.0.1":
                    s.close()
                    return ip
            except OSError:
                continue
        s.close()
    except Exception:
        pass

    # 方法3: 使用 netifaces 如果可用
    try:
        import netifaces
        for iface in netifaces.interfaces():
            addrs = netifaces.ifaddresses(iface)
            if socket.AF_INET in addrs:
                for addr in addrs[socket.AF_INET]:
                    ip = addr.get("addr", "")
                    if ip and not ip.startswith("127."):
                        return ip
    except ImportError:
        pass

    # Fallback
    return "127.0.0.1"


# ─── HMAC 签名 ─────────────────────────────────────────
def sign_discovery_reply(host_id, host_name, ws_url, nonce, secret):
    """生成 HMAC-SHA256 签名, 与固件协议兼容"""
    message = f"discover_reply|{host_id}|{host_name}|{ws_url}|{nonce}"
    return hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


# ─── UDP Discovery 服务 ────────────────────────────────
class UdpDiscoveryServer:
    """UDP 设备发现服务，兼容 vibecoding-voice 固件协议"""

    def __init__(self, ws_port, discovery_port=None, service=None, secret=None, host_id=None):
        self.ws_port = ws_port
        self.discovery_port = discovery_port or DISCOVERY_PORT
        self.service = service or DISCOVERY_SERVICE
        self.secret = secret or LAN_SHARED_SECRET
        self.host_id = host_id or DISCOVERY_HOST_ID
        self.local_ip = get_local_lan_ip()
        self.socket = None
        self._thread = None
        self._running = False
        self._logger = logging.getLogger("llmserve.discovery")

    def start(self):
        """启动 UDP 发现服务（后台线程）"""
        self._running = True
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(("0.0.0.0", self.discovery_port))
        self.socket.settimeout(1.0)

        self._thread = threading.Thread(target=self._listen_loop, daemon=True, name="udp-discovery")
        self._thread.start()

        self._logger.info(
            "UDP Discovery 已启动 (udp://0.0.0.0:%d), 回复 wsUrl: ws://%s:%d",
            self.discovery_port, self.local_ip, self.ws_port
        )
        if self.secret:
            self._logger.info("HMAC 认证已启用 (LAN_SHARED_SECRET 已设置)")
        if self.host_id:
            self._logger.info("Host ID 过滤已启用: %s", self.host_id)

    def stop(self):
        """停止 UDP 发现服务"""
        self._running = False
        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._logger.info("UDP Discovery 已停止")

    def _listen_loop(self):
        """UDP 监听循环（运行在后台线程）"""
        while self._running:
            try:
                data, addr = self.socket.recvfrom(1024)
                self._handle_request(data, addr)
            except socket.timeout:
                continue
            except OSError:
                if self._running:
                    self._logger.warning("UDP socket 异常", exc_info=True)
                break
            except Exception as e:
                if self._running:
                    self._logger.warning("UDP 处理异常: %s", e)

    def _handle_request(self, data, addr):
        """处理单个 UDP 发现请求"""
        try:
            request = json.loads(data.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return

        if request.get("type") != "discover_host":
            return

        req_service = request.get("service", "")
        req_expected_host_id = request.get("expectedHostId", "").strip()
        req_nonce = request.get("nonce", "")
        req_device_id = request.get("deviceId", "unknown")

        # 检查 expectedHostId
        if req_expected_host_id and self.host_id and req_expected_host_id != self.host_id:
            self._logger.debug("忽略不匹配的 expectedHostId: %s (期望: %s)", req_expected_host_id, self.host_id)
            return

        # 构建回复
        ws_url = f"ws://{self.local_ip}:{self.ws_port}"
        reply = {
            "type": "discover_reply",
            "service": self.service,
            "hostId": self.host_id,
            "hostName": socket.gethostname(),
            "wsUrl": ws_url,
            "wsPort": self.ws_port,
            "nonce": req_nonce,
        }

        # HMAC 签名（如果设置了 secret 且请求包含 nonce）
        if self.secret and req_nonce:
            reply["authSig"] = sign_discovery_reply(
                self.host_id, socket.gethostname(), ws_url, req_nonce, self.secret
            )

        reply_data = json.dumps(reply, ensure_ascii=False).encode("utf-8")

        try:
            self.socket.sendto(reply_data, addr)
            self._logger.info(
                "Discovery 回复 -> %s:%d (deviceId=%s, wsUrl=%s)",
                addr[0], addr[1], req_device_id, ws_url
            )
        except Exception as e:
            self._logger.warning("发送 Discovery 回复失败: %s", e)


async def main():
    """启动 WebSocket 服务 + UDP Discovery"""
    if not DASHSCOPE_API_KEY:
        logger.error("请设置环境变量 DASHSCOPE_API_KEY")
        sys.exit(1)

    dashscope.api_key = DASHSCOPE_API_KEY

    # 启动 UDP Discovery 服务
    discovery = UdpDiscoveryServer(ws_port=PORT)
    try:
        discovery.start()
    except OSError as e:
        logger.warning("UDP Discovery 启动失败 (端口 %d 可能被占用): %s", DISCOVERY_PORT, e)
        discovery = None

    local_ip = get_local_lan_ip()

    logger.info("=" * 60)
    logger.info("llmserve 启动中...")
    logger.info(f"  监听地址: {HOST}:{PORT}")
    logger.info(f"  局域网 IP: {local_ip}")
    logger.info(f"  ASR 模型: {ASR_MODEL}")
    logger.info(f"  LLM 模型: {LLM_MODEL}")
    logger.info(f"  System Prompt: {SYSTEM_PROMPT}")
    logger.info(f"  调试 WAV: {'开启' if SAVE_DEBUG_WAV else '关闭'}")
    if discovery:
        logger.info(f"  UDP Discovery: udp://0.0.0.0:{DISCOVERY_PORT}")
    logger.info("=" * 60)

    try:
        async with websockets.serve(handle_client, HOST, PORT):
            logger.info("服务已启动，等待连接...")
            await asyncio.Future()  # 永久运行
    except KeyboardInterrupt:
        pass
    finally:
        if discovery:
            discovery.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("收到中断信号，退出服务")
