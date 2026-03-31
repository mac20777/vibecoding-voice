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

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path -LiteralPath $EspressifRoot)) {
    throw "ESP-IDF 根目录不存在: $EspressifRoot"
}

$idfPath = Join-Path $EspressifRoot "frameworks\esp-idf-v5.5.2"
$idfPython = Join-Path $EspressifRoot "python_env\idf5.5_py3.13_env\Scripts\python.exe"
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
        $flashArgs = @()
        if ($Port) {
            $flashArgs += "-p", $Port
        }

        Write-Host "[INFO] Running idf.py flash"
        & $idfPython $idfPy @flashArgs flash
        if ($LASTEXITCODE -ne 0) {
            throw "idf.py flash 失败"
        }
    }
}
finally {
    Pop-Location
}

Write-Host "[INFO] Done. Mirror build output: $(Join-Path $MirrorDir 'build')"
