; Bundled USBPcap installer for the Xiaomi Bluetooth remote voice capture.
; The official installer is downloaded by scripts/windows/fetch-usbpcap-installer.mjs
; into build-assets/installers before electron-builder runs.

; Stop the broker before electron-builder replaces its executable during an
; upgrade. The per-machine installer is already elevated, so this never adds a
; second UAC prompt.
!macro customInit
  nsExec::ExecToStack '"$SYSDIR\sc.exe" stop "VibeCodingVoiceRemoteBroker"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 +2
  Sleep 5000
!macroend

!macro customInstall
  ; Upgrades must not reinstall the already-present capture driver. Besides
  ; being unnecessary, restarting the driver can momentarily disturb the
  ; Bluetooth adapter and remote input state.
  IfFileExists "$PROGRAMFILES64\USBPcap\USBPcapCMD.exe" vibecodingSkipUsbpcap 0
  IfFileExists "$PROGRAMFILES\USBPcap\USBPcapCMD.exe" vibecodingSkipUsbpcap 0
  File "/oname=$TEMP\USBPcapSetup-1.5.4.0.exe" "${PROJECT_DIR}\build-assets\installers\USBPcapSetup-1.5.4.0.exe"
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Install the USBPcap driver? It is required for Xiaomi Bluetooth remote voice input. Administrator approval is needed only during install or broker upgrades, not at daily startup.$\r$\n$\r$\n是否安装 USBPcap 驱动？小米蓝牙遥控器的语音输入需要它。只在安装或底层服务升级时需要管理员授权，日常开机不再弹出；安装后可能需要重启电脑。" \
    /SD IDYES IDNO vibecodingSkipUsbpcap
  ExecWait '"cmd.exe" /c start "" /wait "$TEMP\USBPcapSetup-1.5.4.0.exe" /S'
  vibecodingSkipUsbpcap:
  Delete "$TEMP\USBPcapSetup-1.5.4.0.exe"

  ; Install a deliberately narrow LocalSystem broker. The fixed script avoids
  ; command-line quoting ambiguity for install paths containing spaces.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\scripts\windows\install-remote-broker.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" vibecodingBrokerInstalled
  MessageBox MB_OK|MB_ICONSTOP \
    "The VibeCoding Voice Remote Broker service could not be registered. Details: $1$\r$\n$\r$\nRepair or rerun setup as an administrator.$\r$\n$\r$\n遥控器后台服务注册失败，请使用管理员权限修复或重新运行安装程序。" \
    /SD IDOK
  Abort
  vibecodingBrokerInstalled:

  ; A release may include the production-signed virtual microphone package.
  ; Development packages intentionally omit it and continue without changing
  ; Windows driver-signing policy.
  IfFileExists "$INSTDIR\resources\virtual-microphone-driver\VibeCodingRemoteMic.inf" 0 vibecodingSkipVirtualMic
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\scripts\windows\install-virtual-microphone.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" vibecodingVirtualMicInstalled
  MessageBox MB_OK|MB_ICONSTOP \
    "The signed VibeCoding Remote Microphone driver could not be installed. Details: $1$\r$\n$\r$\nRepair or rerun setup as an administrator.$\r$\n$\r$\nVibeCoding Remote Microphone 驱动安装失败，请使用管理员权限修复或重新运行安装程序。" \
    /SD IDOK
  Abort
  vibecodingVirtualMicInstalled:
  vibecodingSkipVirtualMic:
!macroend

!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\sc.exe" stop "VibeCodingVoiceRemoteBroker"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 +2
  Sleep 5000
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete "VibeCodingVoiceRemoteBroker"'
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\scripts\windows\install-virtual-microphone.ps1" 0 +2
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\scripts\windows\install-virtual-microphone.ps1" -InstallRoot "$INSTDIR" -Uninstall'
!macroend
