export const VIRTUAL_MIC_MAGIC = 0x524d4356; // "VCMR" in little-endian bytes.
export const VIRTUAL_MIC_HEADER_BYTES = 12;

export const VIRTUAL_MIC_MESSAGE = Object.freeze({
  START: 1,
  PCM16: 2,
  STOP: 3,
  CANCEL: 4,
  EXIT: 5,
  PREPARE: 6
});

export const XIAOMI_REMOTE_VOICE_MODES = Object.freeze({
  BUILTIN_STT: "builtin_stt",
  WECHAT: "wechat"
});

export function normalizeXiaomiRemoteVoiceMode(value) {
  return String(value || "").trim().toLowerCase() === XIAOMI_REMOTE_VOICE_MODES.WECHAT
    ? XIAOMI_REMOTE_VOICE_MODES.WECHAT
    : XIAOMI_REMOTE_VOICE_MODES.BUILTIN_STT;
}

export function encodeVirtualMicrophoneMessage(type, payload = Buffer.alloc(0)) {
  const messageType = Number(type);
  if (!Number.isInteger(messageType) || messageType < 1 || messageType > 0xffff) {
    throw new Error(`Invalid virtual microphone message type: ${type}`);
  }
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length > 16 * 1024 * 1024) {
    throw new Error(`Virtual microphone payload is too large: ${body.length} bytes`);
  }
  const header = Buffer.allocUnsafe(VIRTUAL_MIC_HEADER_BYTES);
  header.writeUInt32LE(VIRTUAL_MIC_MAGIC, 0);
  header.writeUInt16LE(messageType, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt32LE(body.length, 8);
  return body.length ? Buffer.concat([header, body]) : header;
}
