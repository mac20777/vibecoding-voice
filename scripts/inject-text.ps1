param(
    [string]$TextBase64 = "",

    [ValidateSet("type_only", "type_and_enter", "enter_only")]
    [string]$Mode = "type_only",

    [string]$TargetHwnd = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

if ($Mode -eq "enter_only") {
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    return
}

if (-not $TextBase64) {
    return
}

# The WeChat capture flow records which window was focused before recording;
# re-activate it right before pasting so a stale or lost focus cannot swallow
# the transcript. Without a target we paste into whatever is focused now.
if ($TargetHwnd) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class InjectFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
    $target = [IntPtr]::new([Convert]::ToInt64($TargetHwnd, 16))
    $foreground = [InjectFocus]::GetForegroundWindow()
    if ($foreground -ne $target) {
        $currentThread = [InjectFocus]::GetCurrentThreadId()
        $foregroundPid = [uint32]0
        $foregroundThread = [InjectFocus]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
        $attached = $false
        if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
            $attached = [InjectFocus]::AttachThreadInput($currentThread, $foregroundThread, $true)
        }
        try {
            [InjectFocus]::SetForegroundWindow($target) | Out-Null
        } finally {
            if ($attached) {
                [InjectFocus]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null
            }
        }
        Start-Sleep -Milliseconds 120
    }
}

$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextBase64))

$restoreClipboard = $false
$previousClipboard = $null

try {
    $previousClipboard = Get-Clipboard -Raw -Format Text
    $restoreClipboard = $true
} catch {
    $restoreClipboard = $false
}

Set-Clipboard -Value $text
Start-Sleep -Milliseconds 60
[System.Windows.Forms.SendKeys]::SendWait("^v")

if ($Mode -eq "type_and_enter") {
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

Start-Sleep -Milliseconds 180

if ($restoreClipboard) {
    try {
        Set-Clipboard -Value $previousClipboard
    } catch {
    }
}

