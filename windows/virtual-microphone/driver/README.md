# Driver implementation baseline

The production driver must be derived from the pinned Microsoft SysVAD
WaveRT sample, not from a prebuilt third-party virtual cable. Run:

```powershell
.\scripts\windows\bootstrap-virtual-microphone-driver.ps1
```

The resulting reference checkout is intentionally ignored by Git. The product
driver will keep only two endpoints and a shared bounded cable buffer:

- render: `VibeCoding Remote Microphone Input`;
- capture: `VibeCoding Remote Microphone`.

The render miniport copies engine frames into a nonpaged ring. The capture
miniport reads the same timeline, emits silence on underflow, and drops the
oldest unread frames on overflow. Format, clock, position, power, cancellation,
and PnP behavior must remain inside the ordinary PortCls/WaveRT contracts.

No unsigned driver or third-party binary is accepted by the release installer.

