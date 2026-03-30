param(
    [Parameter(Mandatory = $true)]
    [string]$TextBase64,

    [ValidateSet("type_only", "type_and_enter")]
    [string]$Mode = "type_only"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

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
    Start-Sleep -Milliseconds 60
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

Start-Sleep -Milliseconds 180

if ($restoreClipboard) {
    try {
        Set-Clipboard -Value $previousClipboard
    } catch {
    }
}

