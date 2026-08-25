; Bundled USBPcap installer for the Xiaomi Bluetooth remote voice capture.
; The official installer is downloaded by scripts/windows/fetch-usbpcap-installer.mjs
; into build-assets/installers before electron-builder runs.

!macro customInstall
  File "/oname=$TEMP\USBPcapSetup-1.5.4.0.exe" "${PROJECT_DIR}\build-assets\installers\USBPcapSetup-1.5.4.0.exe"
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Install the USBPcap driver? It is required for Xiaomi Bluetooth remote voice input.$\r$\n$\r$\n是否安装 USBPcap 驱动？小米蓝牙遥控器的语音输入需要它。安装时会弹出管理员授权（UAC）提示，装完可能需要重启电脑。" \
    /SD IDYES IDNO vibecodingSkipUsbpcap
  ExecWait '"cmd.exe" /c start "" /wait "$TEMP\USBPcapSetup-1.5.4.0.exe" /S'
  vibecodingSkipUsbpcap:
  Delete "$TEMP\USBPcapSetup-1.5.4.0.exe"
!macroend
