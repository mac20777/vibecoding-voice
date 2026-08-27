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
  -> installed VibeCoding Voice Remote Broker (LocalSystem)
  -> broker-owned USBPcap capture helper
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

- Windows with the remote already paired. First-time pairing can follow the built-in guide: the
  desktop app's Remote page has a pairing checklist (plug in the adapter, hold Home + Menu on the
  remote until the LED blinks, then "Add device" in Windows Bluetooth settings) that detects the
  adapter and the paired remote automatically and opens the Bluetooth settings page for you.
- USBPcap with its filter driver active on the USB Bluetooth adapter. The Windows installer
  offers to run the bundled official USBPcap installer at the end of setup.

Nothing else is required: ATT notification parsing and mSBC decoding are implemented in-process
(`src/usbpcap-att-parser.mjs`, `src/msbc-decoder.mjs`). Wireshark/tshark and FFmpeg are no longer
dependencies, and the matching `XIAOMI_REMOTE_TSHARK_PATH` / `XIAOMI_REMOTE_FFMPEG_PATH` /
`XIAOMI_REMOTE_WSL_DISTRO` settings are ignored.

USBPcap capture needs administrator permission. The Windows installer obtains that permission once and
registers the restricted `VibeCodingVoiceRemoteBroker` service. Normal login startup and later listener
restarts do not show a UAC confirmation. The desktop app remains unelevated, and the broker accepts only
capture start/stop for a verified Bluetooth target plus repair of the supported Xiaomi HID child. It does
not expose a shell or arbitrary executable launch. The module never writes to the remote or its DFU
characteristics; it passively reads traffic from the local USB Bluetooth adapter.

When running directly from a source checkout, the installed broker cannot authenticate `node.exe`, so
the developer command deliberately retains the old per-run UAC fallback.

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
The separately installed remote broker starts with Windows and stays idle until this process requests a
capture, so login startup needs no administrator interaction.

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
reconnect; re-pair the remote. Remote sleep/wake alone does not kill the
capture pipeline, because the USBPcap filter tracks the USB adapter address, not the remote.

### Re-pairing fails after the device was removed

After deleting the remote in Windows Settings, unplug the USB adapter and plug it back into the same
port before pairing again; the radio stack otherwise keeps stale BLE state and the new pairing fails.

Unplugging and replugging the adapter while the app runs needs no manual restart: the broker-owned
capture helper notices the adapter leaving and returning (USB change events, with a slow poll as
fallback) and restarts the capture at the adapter's — possibly new — USB address on its own. Each
restart is sent as a new framed capture generation, which clears partial pcap, Bluetooth-fragment,
button, and voice-session state instead of appending the new stream to the interrupted one.

Replacing the Bluetooth adapter also needs no listener restart when
`XIAOMI_REMOTE_USBPCAP_INTERFACE` is left empty. The helper notices that the healthy BTHUSB adapter
identity changed, enumerates every current USBPcap interface, and follows the replacement adapter
even when it is attached to another USB root controller. The Remote page shows the recovery state.
If Windows keeps showing the old pairing but the remote produces no traffic through the new radio,
remove and pair the remote again — the Remote page pairing guide reopens for exactly this case and
its "Open Bluetooth settings" button jumps straight to the right Settings page; the listener resumes
automatically after pairing. An explicitly configured USBPcap interface remains pinned and is never
switched implicitly.

### Pairing succeeds but Settings shows "driver error"

On the tested stack the remote's BLE GATT HID child device sometimes fails to start (PnP problem
code 10) after a re-pair. This does not break the app's voice capture or button mapping — those
ride the USBPcap path, not the HID child — so try the remote first before rebooting anything.

Leaving the child broken is actually the recommended state. Repairing it turns on Windows' native
HID delivery for the remote: every button press then arrives twice (once from Windows, once from
the app's own mapping), and a repair that lands while a remote key is still held (for example
mid-pairing, where Home + Menu are held for seconds) can swallow the key-up report and leave the
key logically stuck until the adapter is power-cycled.

For that reason the capture helper's HID watchdog is off by default; set
`XIAOMI_REMOTE_HID_AUTOREPAIR=1` to re-enable it. The Remote page keeps a manual repair button
(Repair driver) for users who prefer a clean Settings page and have `XIAOMI_REMOTE_BUTTONS=0`.
From a checkout, the manual equivalent is:

```powershell
npm run remote:xiaomi:fix-hid
```

`npm run remote:xiaomi:doctor` reports the same state read-only. If the child stays unhealthy
afterwards, do a full Windows restart.

### The listener connects and immediately exits

If the log shows `listening` followed at once by `usbpcap exited {"code":0}` (earlier builds logged
`tshark exited {"code":0}`), a leftover `USBPcapCMD.exe`
from a previous run still holds the capture driver. Stop it from an elevated terminal
(`Get-Process USBPcapCMD | Stop-Process -Force`) and restart the app. The bundled pipe helper
watches the listener process id (`-OwnerPid`) in addition to the pipe itself, so it stops its
capture child within about a second of the app exiting — even when the pipe is idle (remote asleep
or unpaired), where a broken pipe would otherwise go unnoticed until the next write.

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
Windows service installed under LocalSystem authenticates the installed desktop executable, validates a
fixed request schema and Bluetooth-only capture target, then starts the fixed PowerShell capture helper.
The helper copies USBPcap's binary output to the requesting process's named pipe, and a kill-on-close job
object prevents its process tree from surviving a broker stop or crash. The Node listener feeds the pipe
to its built-in ATT parser. Windows still owns the paired HID device, but administrator consent is moved
to installation or broker upgrade rather than every listener start. A timed `.pcap` remains the
known-good diagnostic baseline if a future adapter, driver, or remote profile produces no live packets.
