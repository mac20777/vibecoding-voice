# Xiaomi Bluetooth Voice Remote on Windows

`vibecoding-voice` can use a Xiaomi Bluetooth Voice Remote as a push-to-talk microphone on Windows.
The tested device identifies as VID `0x2717`, PID `0x32B8` and sends 16 kHz mono mSBC audio through
Bluetooth HID reports.

For protocol evidence, failure signatures, recovery steps, and a checklist for adapting another remote,
see [Xiaomi remote field notes and adaptation guide](xiaomi-remote-adaptation-notes.md).

## Data path

```text
Xiaomi remote voice key
  -> BARROT USB Bluetooth adapter
  -> elevated USBPcap capture
  -> Windows named pipe
  -> tshark ATT notifications
  -> 60-byte HID voice packets
  -> 57-byte mSBC frames
  -> PCM16 mono / 16 kHz
  -> local VibeCoding Voice WebSocket
  -> STT -> optional translation -> Inject / Codex / Claude
```

The remote emits a control notification when the voice key is pressed and released. During the hold,
three GATT report handles rotate and carry one complete mSBC frame every 7.5 ms. The input module checks
the H2 sequence (`08`, `38`, `c8`, `f8`) and reports packet gaps.

## Requirements

- Windows with the remote already paired.
- USBPcap with its filter driver active on the USB Bluetooth adapter.
- Wireshark command-line tools (`tshark.exe`). Npcap is not required for this USBPcap pipeline.
- FFmpeg:
  - native `ffmpeg.exe` on `PATH`, or
  - FFmpeg installed in the configured WSL distribution.

USBPcap capture needs administrator permission. Windows may show a UAC confirmation when the remote
input process starts. The module never writes to the remote or its DFU characteristics; it passively
reads traffic from the local USB Bluetooth adapter.

## Diagnose

```powershell
npm run remote:xiaomi:doctor
```

Expected output names the selected USBPcap interface, USB device address and FFmpeg decoder.

## Run from source

Start the normal bridge first:

```powershell
npm start
```

In a second terminal, start the persistent remote input:

```powershell
npm run remote:xiaomi
```

Hold the remote voice key, speak, and release. The process sends an immediate `xiaomi_remote` PTT
segment through the same STT and delivery pipeline used by the desktop microphone.

Use `--once` for a one-recording smoke test:

```powershell
node scripts/xiaomi-remote-input.mjs --once
```

## Desktop auto-start

Set the following in the active VibeCoding Voice configuration and restart the desktop app:

```dotenv
XIAOMI_REMOTE_ENABLED=1
XIAOMI_REMOTE_SEND_TARGET=codex_exec
```

The desktop app starts and stops the remote input process together with its local bridge. The target is
optional; leave `XIAOMI_REMOTE_SEND_TARGET` empty to preserve the target selected in the desktop app.

## Configuration

```dotenv
XIAOMI_REMOTE_USBPCAP_PATH=
XIAOMI_REMOTE_TSHARK_PATH=
XIAOMI_REMOTE_USBPCAP_INTERFACE=
XIAOMI_REMOTE_USB_DEVICE=
XIAOMI_REMOTE_USB_ADAPTER_MATCH=BARROT Bluetooth
XIAOMI_REMOTE_FFMPEG_PATH=
XIAOMI_REMOTE_WSL_DISTRO=Ubuntu
XIAOMI_REMOTE_INACTIVITY_MS=900
XIAOMI_REMOTE_SEND_TARGET=codex_exec
```

The interface and device address normally auto-detect from USBPcap's device tree. Explicit values are
useful when more than one USB Bluetooth adapter is connected.

## Current boundary

This first Windows implementation depends on USBPcap and `tshark` because Windows owns the paired HID
device and does not expose its vendor audio reports as a normal microphone. A future native helper can
replace the capture layer without changing the mSBC parser or VibeCoding Voice PTT integration.

Timed capture-to-file, mSBC extraction, decoding, and Volcengine STT were verified twice with real
hardware and zero mSBC sequence errors. The persistent listener was then verified end to end with a real
476-frame voice session: key-down, live capture, key-up, mSBC decode, local WebSocket delivery, and
Volcengine transcription all completed with zero sequence errors.

The live transport deliberately does not use USBPcap's non-elevated stdout forwarding path. A small
elevated PowerShell helper starts USBPcap directly and copies its binary output to a per-process Windows
named pipe. The Node listener feeds that pipe to `tshark`. Windows still owns the paired HID device, and
the user must approve the normal UAC prompt each time the listener starts. A timed `.pcap` remains the
known-good diagnostic baseline if a future adapter, driver, or remote profile produces no live packets.
