param(
    [string]$EspressifRoot = "D:\Espressif",
    [string]$MirrorDir = "D:\zectrix-ascii",
    [switch]$FullClean,
    [switch]$Flash,
    [string]$Port
)

$ErrorActionPreference = "Stop"

function Get-LatestChildDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $Path -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1
}

function Invoke-EsptoolFlash {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BuildDir,
        [Parameter(Mandatory = $true)]
        [string]$EsptoolExe,
        [string]$PortName
    )

    $flashArgsPath = Join-Path $BuildDir "flash_args"
    if (-not (Test-Path -LiteralPath $flashArgsPath)) {
        throw "未找到 flash_args: $flashArgsPath"
    }

    $flashArgs = @(
        "--chip", "esp32s3",
        "-b", "460800",
        "--before", "default_reset",
        "--after", "watchdog_reset",
        "write_flash"
    )
    if ($PortName) {
        $flashArgs = @("--chip", "esp32s3", "-p", $PortName) + $flashArgs[2..($flashArgs.Length - 1)]
    }

    foreach ($line in Get-Content -LiteralPath $flashArgsPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed) {
            continue
        }
        $flashArgs += ($trimmed -split "\s+")
    }

    Write-Host "[INFO] Running esptool watchdog-reset flash"
    Push-Location $BuildDir
    try {
        $esptoolOutput = & $EsptoolExe @flashArgs 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    $esptoolOutput | Out-Host

    if ($exitCode -eq 0) {
        return
    }

    $outputText = ($esptoolOutput | Out-String)
    $verifiedCount = ([regex]::Matches($outputText, "Hash of data verified\.")).Count
    $watchdogResetIssued = $outputText -match "Hard resetting with a watchdog"
    $expectedPortDrop = $outputText -match "Cannot configure port"

    if ($watchdogResetIssued -and $expectedPortDrop -and $verifiedCount -ge 4) {
        Write-Warning "esptool watchdog reset caused COM port re-enumeration after verified flash; treating as success"
        return
    }

    throw "esptool flash 失败"
}

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Clear MSYSTEM so idf.py doesn't mistake this for a MinGW/MSys environment
# (Git Bash sets MSYSTEM=MINGW64 which gets inherited by child processes)
Remove-Item Env:MSYSTEM -ErrorAction SilentlyContinue

if (-not (Test-Path -LiteralPath $EspressifRoot)) {
    throw "ESP-IDF 根目录不存在: $EspressifRoot"
}

$idfPath = Join-Path $EspressifRoot "frameworks\esp-idf-v5.5.2"
$idfPython = Join-Path $EspressifRoot "python_env\idf5.5_py3.13_env\Scripts\python.exe"
$esptoolExe = Join-Path $EspressifRoot "python_env\idf5.5_py3.13_env\Scripts\esptool.exe"
$cmakeBin = Join-Path $EspressifRoot "tools\cmake\3.30.2\bin"
$ninjaBin = Join-Path $EspressifRoot "tools\ninja\1.12.1"
$toolchainRoot = Get-LatestChildDirectory (Join-Path $EspressifRoot "tools\xtensa-esp-elf")
$romElfRoot = Get-LatestChildDirectory (Join-Path $EspressifRoot "tools\esp-rom-elfs")

if (-not (Test-Path -LiteralPath $idfPath)) {
    throw "未找到 IDF_PATH: $idfPath"
}
if (-not (Test-Path -LiteralPath $idfPython)) {
    throw "未找到 ESP-IDF Python: $idfPython"
}
if (-not (Test-Path -LiteralPath $esptoolExe)) {
    throw "未找到 esptool: $esptoolExe"
}
if (-not (Test-Path -LiteralPath $cmakeBin)) {
    throw "未找到 CMake: $cmakeBin"
}
if (-not (Test-Path -LiteralPath $ninjaBin)) {
    throw "未找到 Ninja: $ninjaBin"
}
if (-not $toolchainRoot) {
    throw "未找到 xtensa-esp-elf toolchain"
}

$toolchainBin = Join-Path $toolchainRoot.FullName "xtensa-esp-elf\bin"
if (-not (Test-Path -LiteralPath $toolchainBin)) {
    throw "未找到 xtensa toolchain bin: $toolchainBin"
}

if (-not (Test-Path -LiteralPath $MirrorDir)) {
    New-Item -ItemType Directory -Path $MirrorDir | Out-Null
}

Write-Host "[INFO] Sync project to ASCII mirror: $MirrorDir"
$robocopyArgs = @(
    $projectDir,
    $MirrorDir,
    "/MIR",
    "/XD", "build", ".git", ".idea", ".vscode",
    "/NFL", "/NDL", "/NJH", "/NJS", "/NP"
)
& robocopy @robocopyArgs | Out-Host
if ($LASTEXITCODE -gt 7) {
    throw "robocopy 同步失败，退出码: $LASTEXITCODE"
}

$env:IDF_PATH = $idfPath
$env:IDF_TOOLS_PATH = $EspressifRoot
$env:IDF_PYTHON_ENV_PATH = Split-Path -Parent (Split-Path -Parent $idfPython)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:ESP_IDF_VERSION = "5.5.2"

if ($romElfRoot) {
    $env:ESP_ROM_ELF_DIR = $romElfRoot.FullName
}

$env:PATH = "$cmakeBin;$ninjaBin;$toolchainBin;$env:PATH"

$idfPy = Join-Path $idfPath "tools\idf.py"

Push-Location $MirrorDir
try {
    if ($FullClean) {
        Write-Host "[INFO] Running idf.py fullclean"
        & $idfPython $idfPy fullclean
        if ($LASTEXITCODE -ne 0) {
            throw "idf.py fullclean 失败"
        }
    }

    Write-Host "[INFO] Running idf.py build"
    & $idfPython $idfPy build
    if ($LASTEXITCODE -ne 0) {
        throw "idf.py build 失败"
    }

    if ($Flash) {
        Invoke-EsptoolFlash -BuildDir (Join-Path $MirrorDir "build") -EsptoolExe $esptoolExe -PortName $Port
    }
}
finally {
    Pop-Location
}

Write-Host "[INFO] Done. Mirror build output: $(Join-Path $MirrorDir 'build')"
