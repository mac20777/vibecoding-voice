# Xiaomi Voice Remote Field Notes and Adaptation Guide

This document records the real Windows debugging evidence behind the Xiaomi remote input module. It is
intended to prevent repeated trial and error and to provide a repeatable path for adapting other Bluetooth
voice remotes.

## Verified hardware and software snapshot

- Remote friendly name: `小米蓝牙语音遥控器`
- Remote VID/PID: `0x2717:0x32B8`
- Remote Bluetooth address used in the test: `D4:B8:FF:BF:80:4D`
- USB adapter: `BARROT Bluetooth 5.4 Adapter`
- Adapter driver: Barrot `17.55.6.566`, dated 2024-07-26
- Capture interface: USBPcap root-hub interface containing the BARROT adapter
- Decoder: FFmpeg in WSL Ubuntu at the time of these tests; since replaced by the built-in
  `src/msbc-decoder.mjs` (verified against the same FFmpeg output within 3 LSB)
- STT: Volcengine, through the normal `vibecoding-voice` STT module

The remote firmware was never flashed or modified. USBPcap observes traffic between the existing Windows
Bluetooth stack and the USB adapter; it does not write to the remote.

## What was actually proven

Two independent file recordings were captured, extracted, decoded, and transcribed:

| Recording | Valid mSBC frames | Duration | Sequence errors | Bad packets | Transcript |
| --- | ---: | ---: | ---: | ---: | --- |
| Baseline | 1002 | 7.515 s | 0 | 0 | `这是小米遥控器，这是小米遥控器。54321` |
| Reconnect test | 916 | 6.870 s | 0 | 0 | `正确地址语音测试，1234512345。` |

The production listener was also verified with a third, fully real-time session: 476 mSBC frames,
3.570 seconds of decoded PCM, zero sequence errors, and the transcript `测试遥控器测试遥控器。`.

Together these tests prove both the saved-capture diagnostic path and the persistent path:

```text
remote microphone
  -> Bluetooth HID/ATT notifications
  -> USB HCI traffic
  -> elevated USBPcap
  -> saved pcap or Windows named pipe
  -> ATT notification extraction (tshark during these tests; now built-in src/usbpcap-att-parser.mjs)
  -> mSBC frames
  -> PCM16 mono / 16 kHz
  -> vibecoding-voice STT
  -> correct text
```

## Protocol facts for this remote

### Voice is carried inside HID reports

This model does not expose its microphone as a Windows audio input. Its voice packets appear as ATT
notifications belonging to Bluetooth HID reports. Windows owns the HID service, so a normal WinRT GATT
client sees the HID service but receives `AccessDenied` when it tries to enumerate or subscribe to it.

The device also exposes vendor services such as `D0FF`, `D1FF`, and `6287`. Their presence does not prove
that they carry audio. Direct subscription attempts to `D1FF/A001` and `6287/6487` did not yield this
remote's voice stream. Do not select a service by name alone; validate it against captured payloads.

### Control and audio packets

In the verified captures:

- ATT handle `0x0025` carried 20-byte control reports.
  - first byte `01`: voice stream start
  - first byte `00`: voice stream stop
- ATT handles `0x0029`, `0x002D`, and `0x0031` rotated while the key was held and carried audio.
- Each audio value was 60 bytes:

```text
byte 0      report/status byte, observed as 0x01
byte 1      mSBC H2 sequence: 08 -> 38 -> C8 -> F8 -> repeat
bytes 2-58  one 57-byte mSBC frame, beginning with sync byte 0xAD
byte 59     padding
```

One mSBC frame represents 7.5 ms at 16 kHz mono. Handle numbers are evidence for this firmware, not a
universal contract. Discover them again when adapting another remote or firmware revision.

## The state model that prevented misleading conclusions

Windows Bluetooth UI collapses several independent states into labels such as "Connected" or "Driver
error". Check them separately:

1. **Bond exists**: Windows has a paired-device record.
2. **Root device starts**: the `BTHLE\DEV_...` node has problem code 0.
3. **HID child starts**: the `BTHLEDEVICE\{00001812-...}` node has problem code 0.
4. **BLE link is live**: a GATT operation or real HID input reaches Windows now.
5. **Voice packets exist**: USBPcap captures the start report, rotating audio reports, and stop report.
6. **Audio is valid**: mSBC sequence and frame validation pass.
7. **Product path works**: decoded PCM reaches STT and transcript delivery.

A paired root node with problem code 0 can still be unreachable. A battery service in Device Manager does
not prove that voice data is flowing. Prefer packet evidence over the Settings label.

## Pairing and recovery lessons

### Pairing-key combinations vary

Do not infer the pairing combination from VID/PID or a similar-looking remote. The tested unit is paired to
its Xiaomi TV with **Home + Menu**. Other Xiaomi models or firmware revisions may use Home + Back. Use the
actual remote manual, known TV pairing behavior, and LED pattern as the source of truth.

If a TV or box still owns a bond for the remote, it may reconnect before the PC. For clean experiments,
fully power off the previous host rather than leaving it in standby.

### Deleting the pairing in Windows requires an adapter power cycle

Field-verified on the BARROT adapter: after the remote is removed in Windows Settings, a new pairing
attempt keeps failing until the USB adapter is unplugged and reconnected. The Bluetooth radio stack
keeps stale BLE state across the delete; power-cycling the adapter resets it. The remote itself does
not need its bond cleared first in this case.

Replugging changes the adapter's USB address. The production helper now re-detects that address and
restarts capture without restarting the listener. It can also follow a replacement adapter onto a
different USBPcap root interface unless `XIAOMI_REMOTE_USBPCAP_INTERFACE` is explicitly pinned.
Update `XIAOMI_REMOTE_USB_DEVICE` manually if the USB address itself is pinned.

### "Driver error" was HID problem code 10

The failing device tree looked like this:

```text
Bluetooth root remote                         OK / code 0
Battery, device information, vendor services OK / code 0
Bluetooth LE GATT HID child                  Error / code 10
```

Restarting only the failing HID child with an elevated `pnputil /restart-device <instance-id>` changed it
to `OK / code 0`. A complete Windows restart was still required before the Bluetooth runtime behaved like
the previously successful session. Do not delete the pairing record again until the child problem code has
been checked; repeated delete/re-pair cycles can hide the original failure.

Re-pairing after a Settings delete reproduced code 10 on the HID child again (root and services
stayed OK), and the same `pnputil /restart-device` cleared it. On this stack, treat code 10 on the
HID child as the expected failure after any re-pair: check it first, restart the child, then reboot.
`npm run remote:xiaomi:doctor` reports the HID child problem code read-only, and
`npm run remote:xiaomi:fix-hid` performs the elevated restart and re-check automatically.

Useful read-only inspection:

```powershell
Get-PnpDevice | Where-Object {
  $_.FriendlyName -like '*小米蓝牙语音遥控器*' -or
  $_.InstanceId -like '*VID_2717&PID_32B8*'
} | Format-List Status,Class,FriendlyName,InstanceId,Problem
```

For each returned instance, inspect `DEVPKEY_Device_ProblemCode` with `Get-PnpDeviceProperty`. Code 10 on
the HID child is materially different from an unreachable remote with otherwise healthy device nodes.

## USBPcap lessons

### Never persist a USB device address across restart

The BARROT adapter appeared as USB address `5` before restart and address `3` after restart. Capturing the
stale address produced a 24-byte pcap header or descriptor-only file and no voice traffic. Always run the
USBPcap device-tree query immediately before starting a capture. The production module normally detects
the address by matching `XIAOMI_REMOTE_USB_ADAPTER_MATCH`.

If `XIAOMI_REMOTE_USB_DEVICE` is configured explicitly, remove or update it after replugging the adapter,
restarting USB devices, or rebooting Windows.

### Inject descriptors for tshark

Use `--inject-descriptors`. Without the USB descriptors, tshark may not identify the Bluetooth HCI and ATT
layers in a live or saved capture.

Known-good capture shape:

```powershell
& 'C:\Program Files\USBPcap\USBPcapCMD.exe' `
  -d '\\.\USBPcap1' `
  --devices '<current-address>' `
  --inject-descriptors `
  -o 'remote-voice.pcap'
```

USBPcap requires elevation. The user must approve the UAC prompt; do not automate or bypass it. Stop the
capture only after the voice key has been released so the stop report is included.

### Do not rely on USBPcap's non-elevated stdout forwarding

Timed capture-to-file worked immediately and remains the diagnostic baseline. The first persistent
implementation started USBPcap as a normal child process and relied on USBPcap's own elevation and stdout
forwarding:

```text
USBPcapCMD -o - -> tshark -r -
```

It detected the correct device and started processes, but emitted no live packets on the tested machine.
The working design is:

```text
Node named-pipe server
  <- elevated PowerShell helper
  <- USBPcapCMD binary stdout

Node named-pipe socket
  -> ATT notification lines (tshark at the time; now the built-in src/usbpcap-att-parser.mjs)
```

The helper must launch USBPcap while already elevated and copy
`StandardOutput.BaseStream` directly into the named pipe. This design produced start, rotating audio, and
stop packets in real time and then completed the 476-frame end-to-end STT test. Closing the named pipe
causes the helper to stop its USBPcap child, so the listener does not leave a capture process running —
but only because the helper polls the pipe while streaming. A plain blocking `CopyTo` cannot notice a
broken pipe while the capture is idle, and the orphaned elevated USBPcapCMD keeps the capture driver
busy: the next listener start then connects cleanly and immediately sees the capture stream end
(earlier builds logged `tshark` exit code 0; current builds log `usbpcap exited {"code":0}`). If
that signature appears, kill leftover `USBPcapCMD.exe` processes from an elevated terminal and restart
the listener.

Do not modify the proven mSBC parser while diagnosing this transport boundary. First replay the same saved
pcap through tshark/parser; if replay passes, the bug is before the parser.

## Known-good extraction checks

List ATT notification handles and counts:

```powershell
& 'C:\Program Files\Wireshark\tshark.exe' `
  -n -r '.\remote-voice.pcap' `
  -Y 'btatt.opcode == 0x1b' `
  -T fields -e btatt.handle |
  Group-Object | Sort-Object Count -Descending
```

Extract handle and value pairs:

```powershell
& 'C:\Program Files\Wireshark\tshark.exe' `
  -n -r '.\remote-voice.pcap' `
  -Y 'btatt.opcode == 0x1b' `
  -T fields -E 'separator=|' `
  -e btatt.handle -e btatt.value
```

For an mSBC candidate, require all of the following before decoding:

- consistent 60-byte reports;
- byte 0 identifies the voice report;
- byte 1 follows the four-value H2 sequence;
- byte 2 is mSBC sync `0xAD`;
- bytes 2 through 58 decode as one 57-byte SBC/mSBC frame;
- frame count times 7.5 ms matches the expected speech duration.

## Adapting another Bluetooth voice remote

Follow this order so that a UI or decoder problem is not mistaken for a pairing problem.

### 1. Record identity and device tree

- Friendly names seen during advertising and after pairing
- Bluetooth address
- VID, PID, and revision
- Pairing-key combination and LED behavior
- Standard services and vendor service UUIDs
- Every PnP problem code, especially the HID child

Names such as `mi_mtk` can be transient advertising names. Identity must be tied back to address and
VID/PID before adding it to an adapter profile.

### 2. Prove real connectivity

Do not stop at "paired". Verify at least one of:

- a remote key reaches the OS;
- an uncached GATT operation succeeds while the device is awake;
- USBPcap records HCI/ATT traffic when a button is pressed.

### 3. Capture one complete voice hold

Start before key-down and stop after key-up. Preserve the original pcap as a fixture. Find:

- start and stop packets;
- high-rate notification handles;
- packet lengths and leading bytes;
- sequence counters;
- codec signature.

Do not assume ATVV, mSBC, IMA ADPCM, PCM, or Opus from the product name. Classify from bytes and a real
decode.

### 4. Build a model-specific parser profile

Keep transport, packet parsing, codec decoding, and product delivery separate. A profile should describe:

- control handles and start/stop predicates;
- audio handles;
- report-header length and codec-frame slice;
- sequence validation;
- codec and output sample format;
- inactivity fallback when the stop report is missing.

Add parser tests using sanitized real packet lines or a bounded binary fixture. Include packet gaps, bad
lengths, duplicate start, missing stop, and reconnect behavior.

### 5. Normalize before product integration

The bridge boundary is PCM16 mono / 16 kHz plus `ptt_start` and `ptt_stop`. Keep STT, translation, text
injection, and Codex delivery independent of the remote model. Validate in this order:

```text
saved capture -> parser -> decoder -> WAV listen/check -> STT
             -> local WebSocket dry run -> selected delivery target
```

Use `DRY_RUN_TEXT_INJECTION=1` or an isolated bridge port until the transcript is correct. Do not send a
new remote's first test directly to Codex or another agent target.

## Listener robustness lessons

- Arm the inactivity fallback on session start, not only on audio frames. A press after remote sleep can
  deliver the start report with zero audio frames and no stop report; a start without audio previously
  latched the parser active, so every later key press was swallowed silently while GATT and battery
  still looked fine.
- A dropped start (previous session still decoding) must reset the parser, or the parser and the
  session controller diverge and the remote appears dead.
- `ptt_cancel` needs a native server handler; without one, the bridge stays in recording state after a
  zero-audio press.

## Next development priorities

1. Add a capture-to-file smoke-test command that auto-detects the current USB address and produces a small
   support bundle: pcap metadata, handle histogram, frame count, sequence errors, and decoded WAV.
2. Move handle/report layout into named remote profiles instead of treating the tested values as universal.
3. Add connection diagnostics that report bond, HID problem code, current USB address, and observed packet
   count separately.
4. Keep desktop auto-start unelevated and report the installed remote broker/listening status clearly.
5. Test clean shutdown, repeated starts, adapter replugging, and remote sleep/reconnect over longer runs.
