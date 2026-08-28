const VIRTUAL_MICROPHONE_PATTERN = /(?:vb[ -]?audio|vb-cable|cable output|vibecoding remote microphone|virtual (?:audio|microphone))/i;
const USB_MICROPHONE_PATTERN = /(?:\busb\b|\buac\b|usb audio|audio device)/i;
const MICROPHONE_PATTERN = /(?:microphone|mic\b|麦克风|话筒)/i;

export function isVirtualMicrophoneLabel(label) {
  return VIRTUAL_MICROPHONE_PATTERN.test(String(label || ""));
}

export function selectPreferredLocalMicrophone(devices = []) {
  const candidates = devices
    .filter((device) => device?.kind === "audioinput" && String(device.deviceId || ""))
    .filter((device) => String(device.label || "").trim())
    .filter((device) => !isVirtualMicrophoneLabel(device.label))
    .map((device, index) => {
      const label = String(device.label || "");
      let score = 0;
      if (USB_MICROPHONE_PATTERN.test(label)) {
        score += 100;
      }
      if (MICROPHONE_PATTERN.test(label)) {
        score += 20;
      }
      if (device.deviceId !== "default" && device.deviceId !== "communications") {
        score += 5;
      }
      return { device, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0]?.device || null;
}
