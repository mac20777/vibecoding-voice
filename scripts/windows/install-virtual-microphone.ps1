[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$driverDirectory = Join-Path $InstallRoot "resources\virtual-microphone-driver"
$logDirectory = Join-Path $env:ProgramData "VibeCoding Voice\logs"
$installLog = Join-Path $logDirectory "virtual-microphone-install.log"
$deviceName = "VibeCoding Remote Microphone"
$hardwareId = "Root\VibeCodingVirtualMicrophone"
[System.IO.Directory]::CreateDirectory($logDirectory) | Out-Null

function Write-InstallLog([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') $message" |
    Out-File -LiteralPath $installLog -Encoding utf8 -Append
}

function Invoke-PnpUtil([string[]]$arguments) {
  $output = & "$env:SystemRoot\System32\pnputil.exe" @arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($output) {
    $output | Out-File -LiteralPath $installLog -Encoding utf8 -Append
  }
  if ($exitCode -ne 0) {
    throw "pnputil.exe $($arguments[0]) failed with exit code $exitCode"
  }
  return $output
}

function Assert-ProductionSignature([string]$path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne "Valid") {
    throw "Production-signed virtual microphone file is required: $path ($($signature.Status))"
  }
  $signerSubject = [string]$signature.SignerCertificate.Subject
  if ($signerSubject -notmatch '(?i)Microsoft Windows Hardware Compatibility Publisher') {
    throw "Microsoft hardware-signed virtual microphone catalog is required: $path ($signerSubject)"
  }
}

function Register-VirtualMicrophoneRootDevice {
  # pnputil can stage and bind a driver, but it does not create a root-enumerated
  # device. This small SetupAPI call is the equivalent of devcon install's
  # device-creation step and avoids shipping a WDK development utility.
  if (-not ("VibeCodingVoice.RootDeviceInstaller" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace VibeCodingVoice {
  public static class RootDeviceInstaller {
    private const uint DICD_GENERATE_ID = 0x00000001;
    private const uint SPDRP_HARDWAREID = 0x00000001;
    private const uint DIF_REGISTERDEVICE = 0x00000019;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVINFO_DATA {
      public uint cbSize;
      public Guid ClassGuid;
      public uint DevInst;
      public IntPtr Reserved;
    }

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern IntPtr SetupDiCreateDeviceInfoList(
      ref Guid ClassGuid,
      IntPtr hwndParent);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiCreateDeviceInfo(
      IntPtr DeviceInfoSet,
      string DeviceName,
      ref Guid ClassGuid,
      string DeviceDescription,
      IntPtr hwndParent,
      uint CreationFlags,
      ref SP_DEVINFO_DATA DeviceInfoData);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiSetDeviceRegistryProperty(
      IntPtr DeviceInfoSet,
      ref SP_DEVINFO_DATA DeviceInfoData,
      uint Property,
      byte[] PropertyBuffer,
      uint PropertyBufferSize);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiCallClassInstaller(
      uint InstallFunction,
      IntPtr DeviceInfoSet,
      ref SP_DEVINFO_DATA DeviceInfoData);

    [DllImport("setupapi.dll")]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr DeviceInfoSet);

    private static void ThrowLastError(string operation) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    public static void Register(string hardwareId, string deviceDescription) {
      Guid mediaClass = new Guid("4d36e96c-e325-11ce-bfc1-08002be10318");
      IntPtr deviceInfoSet = SetupDiCreateDeviceInfoList(ref mediaClass, IntPtr.Zero);
      if (deviceInfoSet == INVALID_HANDLE_VALUE) {
        ThrowLastError("SetupDiCreateDeviceInfoList failed");
      }

      try {
        SP_DEVINFO_DATA deviceInfo = new SP_DEVINFO_DATA();
        deviceInfo.cbSize = (uint)Marshal.SizeOf(typeof(SP_DEVINFO_DATA));
        if (!SetupDiCreateDeviceInfo(
          deviceInfoSet,
          "VibeCodingVirtualMicrophone",
          ref mediaClass,
          deviceDescription,
          IntPtr.Zero,
          DICD_GENERATE_ID,
          ref deviceInfo)) {
          ThrowLastError("SetupDiCreateDeviceInfo failed");
        }

        byte[] hardwareIds = Encoding.Unicode.GetBytes(hardwareId + "\0\0");
        if (!SetupDiSetDeviceRegistryProperty(
          deviceInfoSet,
          ref deviceInfo,
          SPDRP_HARDWAREID,
          hardwareIds,
          (uint)hardwareIds.Length)) {
          ThrowLastError("SetupDiSetDeviceRegistryProperty failed");
        }

        if (!SetupDiCallClassInstaller(DIF_REGISTERDEVICE, deviceInfoSet, ref deviceInfo)) {
          ThrowLastError("SetupDiCallClassInstaller failed");
        }
      } finally {
        SetupDiDestroyDeviceInfoList(deviceInfoSet);
      }
    }
  }
}
"@
  }

  [VibeCodingVoice.RootDeviceInstaller]::Register($hardwareId, $deviceName)
}

try {
  if (-not [System.IO.Path]::IsPathRooted($InstallRoot)) {
    throw "InstallRoot must be an absolute path"
  }

  if ($Uninstall) {
    $drivers = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue |
      Where-Object { $_.DeviceName -like "$deviceName*" -and $_.InfName -match '^oem\d+\.inf$' }
    $driverInfNames = @($drivers | Select-Object -ExpandProperty InfName -Unique)
    $rootDevices = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $deviceName -and $_.PNPDeviceID -like 'ROOT\*' }
    foreach ($device in $rootDevices) {
      Invoke-PnpUtil -arguments @("/remove-device", $device.PNPDeviceID, "/subtree") | Out-Null
      Write-InstallLog "removed virtual microphone device $($device.PNPDeviceID)"
    }
    foreach ($infName in $driverInfNames) {
      Invoke-PnpUtil -arguments @("/delete-driver", $infName, "/uninstall", "/force") | Out-Null
      Write-InstallLog "removed virtual microphone driver $infName"
    }
    exit 0
  }

  $inf = Join-Path $driverDirectory "VibeCodingRemoteMic.inf"
  $cat = Join-Path $driverDirectory "VibeCodingRemoteMic.cat"
  $sys = Join-Path $driverDirectory "VibeCodingRemoteMic.sys"
  foreach ($path in @($inf, $cat, $sys)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Virtual microphone package is incomplete: $path"
    }
  }

  # Normal releases must never enable Windows test-signing. Refuse unsigned
  # packages here so a development artifact cannot accidentally ship.
  Assert-ProductionSignature $cat
  # pnputil validates that the INF and SYS bytes are covered by this catalog.
  # A catalog-signed driver does not need a second embedded signature in SYS.
  Invoke-PnpUtil -arguments @("/add-driver", $inf) | Out-Null
  $existingDevice = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $deviceName -and $_.PNPDeviceID -like 'ROOT\*' } |
    Select-Object -First 1
  if (-not $existingDevice) {
    Register-VirtualMicrophoneRootDevice
    Write-InstallLog "created root device for $hardwareId"
  }
  Invoke-PnpUtil -arguments @("/add-driver", $inf, "/install") | Out-Null
  Write-InstallLog "production-signed virtual microphone driver installed from $inf"
  exit 0
} catch {
  Write-InstallLog "virtual microphone operation failed: $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
