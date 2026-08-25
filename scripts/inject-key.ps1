param(
  [Parameter(Mandatory=$true)]
  [string]$Key
)

$ErrorActionPreference = "Stop"

# Virtual-key codes for the keys the Xiaomi remote buttons can be mapped to.
$virtualKeys = @{
  "up" = 0x26
  "down" = 0x28
  "left" = 0x25
  "right" = 0x27
  "enter" = 0x0D
  "escape" = 0x1B
  "home" = 0x24
  "menu" = 0x5D
  "volume_up" = 0xAF
  "volume_down" = 0xAE
}

$normalized = $Key.ToLowerInvariant()
if (-not $virtualKeys.ContainsKey($normalized)) {
  throw "Unknown key name: $Key"
}

Add-Type -Namespace VibeCoding -Name KeyboardInput -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class KeyboardInput {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

# A short tap: key down, brief pause, key up (0x02 = KEYEVENTF_KEYUP).
$vk = [byte]$virtualKeys[$normalized]
[VibeCoding.KeyboardInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[VibeCoding.KeyboardInput]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
