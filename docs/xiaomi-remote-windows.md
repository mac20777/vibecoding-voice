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
  -> built-in pcap/ATT parser (src/usbpcap-att-parser.mjs)
  -> 60-byte HID voice packets
  -> 57-byte mSBC frames
  -> built-in mSBC decoder (src/msbc-decoder.mjs)
  -> PCM16 mono / 16 kHz
  -> local VibeCoding Voice WebSocket
  -> STT -> optional translation -> Inject / Codex / Claude
```

The remote emits a control notification when the voice key is pressed and released. During the hold,
three GATT report handles rotate and carry one complete mSBC frame every 7.5 ms. The input module checks
the H2 sequence (`08`, `38`, `c8`, `f8`) and reports packet gaps.

## Requirements

- Windows with the remote already paired.
- USBPcap with its filter driver active on the USB Bluetooth adapter. The Windows installer
  offers to run the bundled official USBPcap installer at the end of setup.

Nothing else is required: ATT notification parsing and mSBC decoding are implemented in-process
(`src/usbpcap-att-parser.mjs`, `src/msbc-decoder.mjs`). Wireshark/tshark and FFmpeg are no longer
dependencies, and the matching `XIAOMI_REMOTE_TSHARK_PATH` / `XIAOMI_REMOTE_FFMPEG_PATH` /
`XIAOMI_REMOTE_WSL_DISTRO` settings are ignored.

USBPcap capture needs administrator permission. Windows may show a UAC confirmation when the remote
input process starts. The module never writes to the remote or its DFU characteristics; it passively
reads traffic from the local USB Bluetooth adapter.

## Diagnose

```powershell
npm run remote:xiaomi:doctor
```

Expected output names the selected USBPcap interface and USB device address.

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
XIAOMI_REMOTE_USBPCAP_INTERFACE=
XIAOMI_REMOTE_USB_DEVICE=
XIAOMI_REMOTE_USB_ADAPTER_MATCH=BARROT Bluetooth
XIAOMI_REMOTE_INACTIVITY_MS=900
XIAOMI_REMOTE_SEND_TARGET=codex_exec
```

Deprecated and ignored: `XIAOMI_REMOTE_TSHARK_PATH`, `XIAOMI_REMOTE_FFMPEG_PATH`,
`XIAOMI_REMOTE_WSL_DISTRO` (ATT parsing and mSBC decoding are built in now).

The interface and device address normally auto-detect from USBPcap's device tree. Explicit values are
useful when more than one USB Bluetooth adapter is connected.

## Button mapping

Besides the voice key, the remote's other buttons (up/down/left/right, OK, back, home, volume +/-)
arrive on the same capture as standard HID reports and are mapped to synthetic key presses:

| Remote button | Injected key |
| --- | --- |
| up / down / left / right | arrow keys |
| OK (center) | Enter |
| back | Escape |
| home | Home |
| volume + / volume - | system volume |

This drives CLI menus (Codex/Claude selection lists, shell history with up/down) without touching the
keyboard. Disable everything with `XIAOMI_REMOTE_BUTTONS=0`, or override single buttons with
`XIAOMI_REMOTE_BUTTON_MAP=ok:enter,back:escape,menu:none` (`none` disables a button).
The desktop app exposes the same mapping under Settings → Remote: click a button on the virtual
remote, pick an action, and Save (it writes `XIAOMI_REMOTE_BUTTON_MAP` for you).

Note: when the remote's Windows HID child device is healthy, Windows *also* delivers these keys
natively and every press would register twice. The mapping is intended for (and was developed on) a
stack where that HID child reports problem code 10; if `npm run remote:xiaomi:fix-hid` repairs it,
either leave the child broken or set `XIAOMI_REMOTE_BUTTONS=0`.

## Troubleshooting

### Connected with battery level, but the voice key does nothing

A paired remote with a live battery service only proves the BLE/GATT link, not that HID voice
notifications are flowing. The listener arms its inactivity fallback as soon as a key-down arrives, so
a press that produces no audio frames is cancelled within `XIAOMI_REMOTE_INACTIVITY_MS`
(default 900 ms), logged as `voice session ignored: no audio frames`, and later presses keep working.

If every press logs "no audio frames", the remote's voice stream did not resume after sleep or
reconnect; re-pair the remote or restart the listener. Remote sleep/wake alone does not kill the
capture pipeline, because the USBPcap filter tracks the USB adapter address, not the remote.

### Re-pairing fails after the device was removed

After deleting the remote in Windows Settings, unplug the USB adapter and plug it back into the same
port before pairing again; the radio stack otherwise keeps stale BLE state and the new pairing fails.
Restart the remote input listener afterwards so it re-detects the adapter's USB address.

### Pairing succeeds but Settings shows "driver error"

On the tested stack the remote's BLE GATT HID child device sometimes fails to start (PnP problem
code 10) after a re-pair. Run:

```powershell
npm run remote:xiaomi:fix-hid
```

It locates the remote's HID child, restarts it with an elevated `pnputil /restart-device` (one UAC
prompt), and re-checks the problem code. `npm run remote:xiaomi:doctor` reports the same state
read-only. If the child stays unhealthy afterwards, do a full Windows restart.

### The listener connects and immediately exits

If the log shows `listening` followed at once by `usbpcap exited {"code":0}` (earlier builds logged
`tshark exited {"code":0}`), a leftover `USBPcapCMD.exe`
from a previous run still holds the capture driver. Stop it from an elevated terminal
(`Get-Process USBPcapCMD | Stop-Process -Force`) and restart the app. The bundled pipe helper now
watches the pipe while idle, so it stops its capture child instead of being orphaned.

## Current boundary

This Windows implementation still depends on the USBPcap filter driver because Windows owns the
paired HID device and does not expose its vendor audio reports as a normal microphone. Everything
above the capture — pcap parsing, ATT notification extraction, mSBC decoding — runs in-process with
no external tools. A future native helper can replace the capture layer without changing the parser
or VibeCoding Voice PTT integration.

Timed capture-to-file, mSBC extraction, decoding, and Volcengine STT were verified twice with real
hardware and zero mSBC sequence errors. The persistent listener was then verified end to end with a real
476-frame voice session: key-down, live capture, key-up, mSBC decode, local WebSocket delivery, and
Volcengine transcription all completed with zero sequence errors.

The live transport deliberately does not use USBPcap's non-elevated stdout forwarding path. A small
elevated PowerShell helper starts USBPcap directly and copies its binary output to a per-process Windows
named pipe. The Node listener feeds that pipe to its built-in ATT parser. Windows still owns the paired
HID device, and
the user must approve the normal UAC prompt each time the listener starts. A timed `.pcap` remains the
known-good diagnostic baseline if a future adapter, driver, or remote profile produces no live packets.
