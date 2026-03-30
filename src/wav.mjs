export function pcm16MonoToWav(pcmBuffer, sampleRate = 16000) {
  const pcmByteLength = pcmBuffer.byteLength;
  const wav = Buffer.alloc(44 + pcmByteLength);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcmByteLength, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcmByteLength, 40);
  pcmBuffer.copy(wav, 44);

  return wav;
}

