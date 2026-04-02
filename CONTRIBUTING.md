# Contributing

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Fill in your own provider credentials.

## Development

- Run `npm test` before sending a change.
- Use `MOCK_TRANSCRIPT` and `DRY_RUN_TEXT_INJECTION=1` for safe local testing.
- Keep changes scoped; this repo is the host bridge, not the ESP32 firmware.

## Board Notes

These notes are specific to the Zectrix S3 e-paper LAN mic firmware path and record the main issues hit during bring-up.

### 1. Post-flash freeze and dead buttons

Observed symptom:

- After flashing, the board could boot into `Finding ...` / `No Srv` and all buttons appeared dead.
- A normal USB re-enumeration reset could recover it, which made the problem look like a networking issue even when the real failure was local input handling.

Root cause:

- In `CONFIG_ZECTRIX_LAN_MIC_MODE`, the board layer and `LanMicApp` were both creating button handlers for the same GPIOs.
- The fix was to disable the board-level buttons in LAN mic mode and let `LanMicApp` own them exclusively.

Relevant files:

- `firmware/main/boards/zectrix-s3-epaper-4.2/zectrix-s3-epaper-4.2.cc`
- `firmware/main/lan_mic_app.cc`

Rule:

- Do not re-enable board-level navigation buttons in LAN mic mode unless ownership is redesigned end-to-end.

### 2. Flash reset path is not the same as a normal reboot

Observed symptom:

- The board could behave differently immediately after flashing than after a later USB reset or power cycle.
- Some reset paths looked like "Wi-Fi or service reconnect broke", but the actual issue was the reset path itself.

Root cause:

- `esptool` post-flash reset behavior mattered on this board.
- `watchdog_reset` / overly broad deep-sleep bounce logic was flaky after flash.
- The stable path was:
  - use `--after hard_reset` in `firmware/build_windows.ps1`
  - keep the one-shot deep-sleep bounce narrowly scoped to `ESP_RST_SW`
  - do not bounce `ESP_RST_EXT` after flashing

Relevant files:

- `firmware/build_windows.ps1`
- `firmware/main/main.cc`

Rule:

- When debugging "works after USB reset but not right after flash", check the reset reason and flashing script before touching reconnect logic.

### 3. Serial monitoring can change the behavior under test

Observed symptom:

- Opening the serial monitor after flashing could trigger a USB disconnect / reconnect sound and effectively reset the board again.
- That masked the original "first boot after flash" behavior.

Root cause:

- The ESP32-S3 USB serial/JTAG path can re-enumerate on monitor attach or reset-related actions.

Rule:

- If the problem is "first boot after flash", avoid attaching a serial monitor until after reproducing the issue once.
- Distinguish "flash first boot" from "boot after monitor-triggered USB reset".

### 4. Reconnect bugs were partly host discovery state bugs

Observed symptom:

- After server restart, the board could briefly show `Will retry automatically`, then miss the recovery window and stay stuck in `Finding ...` / `Connect failed`.
- Manual reset could recover it.

Root cause:

- The board originally dropped the last good discovered server URI too aggressively and could fall back to an outdated fixed IP.
- The fix was to persist and reuse:
  - cached last-good `wsUrl`
  - paired `hostId`
  - paired `hostName`
- Reconnect order now matters: discovery -> cached URI -> optional fallback.

Relevant files:

- `firmware/main/lan_mic_app.cc`

Rule:

- For LAN deployments, do not depend on a hard-coded `CONFIG_LAN_MIC_SERVER_URI` as the primary path.
- Treat fallback IP as debug-only or last-resort.

### 5. Blocking reconnect work can look like a UI freeze

Observed symptom:

- During reconnect storms, the device could look half-dead: status text changed, but buttons and UI response were delayed enough to be misleading.

Root cause:

- Synchronous reconnect work in the main loop made the app look frozen even when it had not actually crashed.
- Running reconnect attempts in a dedicated FreeRTOS task fixed the responsiveness issue.

Relevant files:

- `firmware/main/lan_mic_app.h`
- `firmware/main/lan_mic_app.cc`

Rule:

- Keep long reconnect / discovery work off the main UI loop.

### 6. Current regression checklist for board changes

When touching board bring-up, reconnect, or flashing behavior, re-test these exact cases:

1. Flash -> automatic reboot -> board should not freeze and buttons must work.
2. Flash -> do not open serial monitor -> verify the first boot behavior separately.
3. Server restart while board is online -> board must reconnect without manual reset.
4. Miss the short reconnect window intentionally -> board must still reconnect later.
5. Wi-Fi reset / network reset -> paired host cache should clear as expected.
6. Record multiple segments -> `BOOT Add | UP Send | DN Undo` flow still works.

## Release

### npm package

Package name: `@mac20777/vibecoding-voice`

Recommended release flow:

1. Bump `package.json` and `package-lock.json`.
2. Commit the version bump.
3. Create an annotated tag such as `v0.2.0`.
4. Push branch and tag: `git push origin <branch> --follow-tags`
5. Publish to npm.

Important: on this machine, `NODE_AUTH_TOKEN=... npm publish` was not sufficient for publishing. npm only accepted the token when it was provided through an `.npmrc` entry for the registry.

Use a temporary user config file instead of editing the real user config:

```powershell
$tempNpmrc = Join-Path (Resolve-Path .) '.tmp-npmrc'
Set-Content -Path $tempNpmrc -Value '//registry.npmjs.org/:_authToken=YOUR_TOKEN' -NoNewline
$env:NPM_CONFIG_USERCONFIG = $tempNpmrc
npm publish --cache .npm-cache
Remove-Item Env:NPM_CONFIG_USERCONFIG -ErrorAction SilentlyContinue
Remove-Item $tempNpmrc -ErrorAction SilentlyContinue
```

Notes:

- `npm publish --cache .npm-cache` successfully published `0.1.0` and `0.2.0`.
- If npm returns `EOTP` while using a token, the token is not actually bypassing 2FA for publish.
- Revoke any token that was pasted into chat or shell history after the release is complete.

### GitHub release

After pushing the tag, create the GitHub release, for example:

```powershell
gh release create v0.2.0 --repo macheng2017/vibecoding-voice --title "v0.2.0"
```

## Secrets And Local Data

- Never commit `.env`.
- Do not hardcode provider keys, local usernames, or machine-specific paths.
- Prefer generic defaults like `codex` over absolute local shim paths.
