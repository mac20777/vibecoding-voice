# ESP32 firmware reconnect debug notes

Date: 2026-05-05

## Problem

The ESP32 board could reconnect if the desktop service was stopped and restarted quickly. If the service stayed down for roughly 30 seconds or longer, the board would never reconnect until the board itself was rebooted.

Observed desktop side:

- `VibeCoding Voice.exe` was listening on `8765` WebSocket and `8766` UDP discovery.
- `127.0.0.1 -> 127.0.0.1:8765` is the desktop app's local monitor connection, not the board.
- A real board connection looks like `192.168.3.66 -> 192.168.3.71:8765 Established`.
- `tmp_server_stdout.log` was stale from 2026-04-02, so it was not useful for current connection state.

## Reproduction

1. Flash firmware to `COM9`.
2. Start serial logging at `115200`.
3. Confirm the board connects to the desktop service.
4. Stop all `VibeCoding Voice` processes.
5. Wait 45 seconds.
6. Restart `D:\Program Files\VibeCoding Voice\VibeCoding Voice.exe`.
7. Check whether `Get-NetTCPConnection -LocalPort 8765` shows the board IP.

Useful commands:

```powershell
Get-NetTCPConnection -LocalPort 8765 |
  Format-Table -AutoSize LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess

Get-NetUDPEndpoint -LocalPort 8766 |
  Format-Table -AutoSize LocalAddress,LocalPort,OwningProcess

Get-Process -Name 'VibeCoding Voice' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath 'D:\Program Files\VibeCoding Voice\VibeCoding Voice.exe' -WindowStyle Hidden
```

## Serial Evidence

The important failing sequence before the final fix:

```text
EspTcp: TCP receive failed: -1
LanMicApp: WebSocket disconnected
LanMicApp: Connecting via discovery: ws://192.168.3.71:8765
EspTcp: Connect timeout to 192.168.3.71:8765
LanMicApp: Discovered URI failed, forcing discovery next round
LanMicApp: Discovery attempt 1/3
... no Discovery attempt 2/3 ...
LanMicApp: Connect attempt watchdog fired
```

The key clue was that `Discovery attempt 1/3` did not return. The reconnect task was stuck inside UDP discovery, so `connect_attempt_running_` stayed true and future reconnects were blocked. Rebooting the board worked because it killed the stuck task and reset the socket/network state.

## Root Cause

`LanMicApp::DiscoverServerUri()` used a blocking UDP socket and relied on `SO_RCVTIMEO` to make `recvfrom()` return after the discovery timeout. On this ESP32/lwIP path, that timeout did not reliably wake `recvfrom()`. When the desktop service was offline long enough for the firmware to enter discovery, the reconnect task could block indefinitely.

The "30 seconds" symptom was timing dependent: quick service restarts could be caught by the cached TCP reconnect path. Longer outages forced the firmware into UDP discovery, where it could hang.

## Final Fix

The discovery socket is now explicitly non-blocking and bounded by `select()`:

- `firmware/main/lan_mic_app.cc`
  - `DiscoverServerUri()` calls `fcntl(sock, F_SETFL, flags | O_NONBLOCK)`.
  - The receive loop waits with `select(sock + 1, ...)` using the per-attempt deadline.
  - `recvfrom()` handles `EAGAIN` / `EWOULDBLOCK` as "no packet yet".
  - Each discovery attempt now returns on schedule instead of depending on `SO_RCVTIMEO`.

Additional hardening kept from the same debug session:

- WebSocket/TCP failure paths clean up sockets and callbacks more aggressively.
- TCP connect/send/receive paths have short timeouts.
- Repeated reconnect failures trigger Wi-Fi station recovery.
- The connect watchdog now runs recovery before display refresh, so UI updates cannot prevent recovery.

## Verified Behavior

After the fix, the same 45-second service outage was tested:

```text
LanMicApp: Discovery attempt 1/3
LanMicApp: Discovery attempt 2/3
LanMicApp: Discovery attempt 3/3
...
LanMicApp: WebSocket connected
```

Desktop side showed the board reconnected:

```text
192.168.3.71  8765  192.168.3.66  <port>  Established
```

## Pitfalls

- Do not trust stale `tmp_server_stdout.log`; check live ports and serial logs.
- Do not count `127.0.0.1` WebSocket connections as the board.
- Reducing reconnect interval does not help if the reconnect task is blocked.
- A watchdog that only changes UI state does not fix a blocked socket call.
- Wi-Fi recovery can help after repeated failures, but it cannot fix a task blocked forever in `recvfrom()`.
- On ESP32/lwIP, prefer non-blocking sockets plus `select()` for strict LAN discovery deadlines.
- Always test reconnect with the service down for more than one retry cycle, not only quick restarts.

## Follow-up Tooling

The project now has extra diagnostics for this class of issue:

```powershell
npm run doctor
```

`doctor` reports:

- WebSocket listener PID/process/path for `LAN_VOICE_PORT`.
- Current LAN board/client connections, excluding localhost monitor connections.
- UDP discovery endpoint PID/process/path for `LAN_DISCOVERY_PORT`.
- Current runtime log path.

Hardware reconnect smoke test:

```powershell
npm run test:reconnect -- --outage-sec 45 --restore-sec 30
```

Optional filters:

```powershell
npm run test:reconnect -- --device-ip 192.168.3.66
npm run test:reconnect -- --service-exe "D:\Program Files\VibeCoding Voice\VibeCoding Voice.exe"
```

The smoke test stops `VibeCoding Voice`, waits for the outage window, starts it again, then polls `Get-NetTCPConnection` until a non-localhost board connection is established.

## Offline Power Behavior

The board uses an e-paper display, so the screen image can remain visible while the MCU is asleep. To avoid overnight battery drain when the desktop service is off:

- If the service stays unavailable for 5 minutes, firmware enters deep sleep even from Offline Todo mode.
- BOOT wakes the board immediately.
- A timer wakes the board every 15 minutes for a short reconnect window.
- On timer wake, the board stays awake for 1 minute to retry Wi-Fi/discovery/WebSocket; if the service is still unavailable, it sleeps again.
- Pending offline todo operations are persisted before sleep and can sync after the next successful connection.

The important pitfall was that the old sleep condition required `!offline_todo_mode_`, while the reconnect UI entered `offline_todo_mode_` after disconnect. That made the intended 5-minute deep sleep path unreachable during real service outages.
