# VibeCoding Remote Microphone

The Windows product path is a paired virtual audio cable:

1. `vibecoding-virtual-mic-publisher.exe` receives framed PCM16LE, 16 kHz,
   mono audio from the Xiaomi remote process.
2. The publisher renders that stream through shared-mode WASAPI to the hidden
   `VibeCoding Remote Microphone Input` render endpoint.
3. The WaveRT driver loops render frames through a bounded kernel ring into the
   public `VibeCoding Remote Microphone` capture endpoint.
4. WeChat selects the capture endpoint as its microphone.

Using WASAPI for the user-to-driver boundary avoids a private device-control
protocol and lets the Windows audio engine perform the 16 kHz mono conversion.

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

The driver source is pinned to Microsoft's SysVAD design and lives under
`driver/sysvad`. Build it with `npm run virtual-mic:build-driver`; the command
uses the x64 MSBuild host, validates the INF, and generates an unsigned catalog
under `out/virtual-microphone-driver-release`. A local WDK test certificate may
sign the SYS during development, but neither that SYS nor an unsigned/test
catalog is accepted by the normal product installer. Microsoft attestation or
HLK signing remains the release gate.
