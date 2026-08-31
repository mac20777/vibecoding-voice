# VibeCoding Remote Microphone

The current Windows product path uses the production-signed VB-CABLE endpoints:

1. `vibecoding-virtual-mic-publisher.exe` receives framed PCM16LE, 16 kHz,
   mono audio from the Xiaomi remote process.
2. On push-to-talk start, a `PREPARE` message snapshots the current Windows
   capture defaults and temporarily routes the console, multimedia, and
   communications roles to `CABLE Output (VB-Audio Virtual Cable)` while the
   user is still speaking.
3. After key release, the publisher taps WeChat Input Method's `Ctrl+Win+Shift`
   start shortcut and reports `shortcut_pressed`; only then is the buffered
   remote stream rendered through shared-mode WASAPI to
   `CABLE Input (VB-Audio Virtual Cable)`.
4. After the audio queue drains, the publisher taps the same shortcut to stop
   recognition and restores the prior capture defaults. The publisher reports
   `session_idle` only after this finishes, so a later push-to-talk cycle cannot
   overlap the previous one. A per-user route-state file provides recovery after
   an unexpected helper or application exit, and restoration skips roles the
   user changed manually.

Using WASAPI for the user-to-driver boundary avoids a private device-control
protocol and lets the Windows audio engine perform the 16 kHz mono conversion.

The custom SysVAD implementation below remains an experimental alternative. It
is not included in normal development installers unless a production-signed
driver package is explicitly staged.

## Product safety gates

The normal installer only accepts a production-signed `.cat` and `.sys`. It
does not enable Windows test-signing. Before a driver package is staged in
`build-assets/virtual-microphone-driver`, it must pass:

- a WDK build with the SDK and WDK build numbers matched;
- `InfVerif` and `Inf2Cat`;
- render-to-capture waveform and latency tests through public WASAPI endpoints;
- unplug/replug, sleep/resume, app crash, and 24-hour stream stress tests;
- Driver Verifier on a disposable test machine;
- Microsoft attestation or HLK signing for the supported Windows releases.

`npm run virtual-mic:validate-driver` is also part of Windows packaging. It
allows a development build with no driver files, but rejects a partial package,
a non-Microsoft-signed catalog, or a SYS file that is not covered by that
catalog. This prevents a local/test driver from silently becoming a release
artifact.

When the three production-signed files are staged, the NSIS installer adds the
package to the Windows driver store, creates the root-enumerated virtual audio
device through SetupAPI on first install, and binds the driver. Uninstall first
removes that root device and then removes its OEM driver package. The SetupAPI
step is embedded in the install script, so no WDK-only `devcon.exe` utility is
shipped to users.

The driver source is pinned to Microsoft's SysVAD design and lives under
`driver/sysvad`. Build it with `npm run virtual-mic:build-driver`; the command
uses the x64 MSBuild host, validates the INF, and generates an unsigned catalog
under `out/virtual-microphone-driver-release`. A local WDK test certificate may
sign the SYS during development, but neither that SYS nor an unsigned/test
catalog is accepted by the normal product installer. Microsoft attestation or
HLK signing remains the release gate.
