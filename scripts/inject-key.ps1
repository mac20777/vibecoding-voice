param(
  [Parameter(Mandatory=$true)]
  [string]$Key
)

$ErrorActionPreference = "Stop"

# Virtual-key codes for named keys the Xiaomi remote buttons can be mapped to.
$namedKeys = @{
  "up" = 0x26
  "down" = 0x28
  "left" = 0x25
  "right" = 0x27
  "enter" = 0x0D
  "escape" = 0x1B
  "tab" = 0x09
  "space" = 0x20
  "backspace" = 0x08
  "delete" = 0x2E
  "home" = 0x24
  "end" = 0x23
  "pageup" = 0x21
  "pagedown" = 0x22
  "menu" = 0x5D
  "volume_up" = 0xAF
  "volume_down" = 0xAE
  "f1" = 0x70; "f2" = 0x71; "f3" = 0x72; "f4" = 0x73
  "f5" = 0x74; "f6" = 0x75; "f7" = 0x76; "f8" = 0x77
  "f9" = 0x78; "f10" = 0x79; "f11" = 0x7A; "f12" = 0x7B
}

$modifierKeys = @{
  "ctrl" = 0x11
  "control" = 0x11
  "shift" = 0x10
  "alt" = 0x12
  "win" = 0x5B
}

function Resolve-KeyCode([string]$name) {
  $normalized = $name.Trim().ToLowerInvariant()
  if ($namedKeys.ContainsKey($normalized)) {
    return [byte]$namedKeys[$normalized]
  }
  if ($modifierKeys.ContainsKey($normalized)) {
    return [byte]$modifierKeys[$normalized]
  }
  # Single letters/digits map to their own virtual-key codes.
  if ($normalized -match '^[a-z0-9]$') {
    return [byte][char]$normalized.ToUpperInvariant()[0]
  }
  throw "Unknown key name: $name"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class VibeCodingKeyboardInput {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$parts = $Key.Split("+") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($parts.Count -eq 0) {
  throw "Empty key spec"
}

$modifiers = @()
$mainKey = $null
foreach ($part in $parts) {
  if ($modifierKeys.ContainsKey($part.Trim().ToLowerInvariant()) -and $null -eq $mainKey) {
    $modifiers += [byte]$modifierKeys[$part.Trim().ToLowerInvariant()]
  } else {
    $mainKey = Resolve-KeyCode $part
  }
}
if ($null -eq $mainKey) {
  throw "Combo needs a non-modifier key: $Key"
}

# Press modifiers, tap the main key (0x02 = KEYEVENTF_KEYUP), release modifiers.
foreach ($mod in $modifiers) {
  [VibeCodingKeyboardInput]::keybd_event($mod, 0, 0, [UIntPtr]::Zero)
}
Start-Sleep -Milliseconds 20
[VibeCodingKeyboardInput]::keybd_event($mainKey, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[VibeCodingKeyboardInput]::keybd_event($mainKey, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 20
[array]::Reverse($modifiers)
foreach ($mod in $modifiers) {
  [VibeCodingKeyboardInput]::keybd_event($mod, 0, 2, [UIntPtr]::Zero)
}
