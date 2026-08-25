// Pure-JavaScript mSBC decoder (no external processes or dependencies).
//
// mSBC is the fixed-parameter SBC variant used for HFP wideband speech
// (HFP 1.6): 16 kHz, mono, 15 blocks, 8 subbands, LOUDNESS bit allocation,
// bitpool 26. Frames are 57 bytes and start with syncword 0xAD; each frame
// decodes to 15 * 8 = 120 PCM16 samples.
//
// The decoder implements the SBC decoding process from the Bluetooth A2DP
// specification (Appendix B): frame unpacking, CRC-8 check, bit allocation,
// subband sample reconstruction and the 8-subband polyphase synthesis
// filter. The prototype filter coefficients in SYNTH_PROTO_8_80 are
// normative data from that specification (Table 12.24, read row-wise).

export const MSBC_FRAME_LENGTH = 57;
export const MSBC_SAMPLES_PER_FRAME = 120; // 15 blocks * 8 subbands

const MSBC_SYNCWORD = 0xad;
const MSBC_BLOCKS = 15;
const MSBC_SUBBANDS = 8;
const MSBC_BITPOOL = 26;

// Loudness offsets for 16 kHz with 8 subbands (spec Table 12.22).
const LOUDNESS_OFFSETS_8 = [-2, 0, 0, 0, 0, 0, 0, 1];

// Synthesis prototype filter for 8 subbands (spec Table 12.24).
const SYNTH_PROTO_8_80 = [
  0.00000000e0, 1.56575398e-4, 3.43256425e-4, 5.54620202e-4,
  8.23919506e-4, 1.13992507e-3, 1.47640169e-3, 1.78371725e-3,
  2.01182542e-3, 2.10371989e-3, 1.99454554e-3, 1.61656283e-3,
  9.02154502e-4, -1.78805361e-4, -1.64973098e-3, -3.49717454e-3,
  5.65949473e-3, 8.02941163e-3, 1.04584443e-2, 1.27472335e-2,
  1.46525263e-2, 1.59045603e-2, 1.62208471e-2, 1.53184106e-2,
  1.29371806e-2, 8.85757540e-3, 2.92408442e-3, -4.91578024e-3,
  -1.46404076e-2, -2.61098752e-2, -3.90751381e-2, -5.31873032e-2,
  6.79989431e-2, 8.29847578e-2, 9.75753918e-2, 1.11196689e-1,
  1.23264548e-1, 1.33264415e-1, 1.40753505e-1, 1.45389847e-1,
  1.46955068e-1, 1.45389847e-1, 1.40753505e-1, 1.33264415e-1,
  1.23264548e-1, 1.11196689e-1, 9.75753918e-2, 8.29847578e-2,
  -6.79989431e-2, -5.31873032e-2, -3.90751381e-2, -2.61098752e-2,
  -1.46404076e-2, -4.91578024e-3, 2.92408442e-3, 8.85757540e-3,
  1.29371806e-2, 1.53184106e-2, 1.62208471e-2, 1.59045603e-2,
  1.46525263e-2, 1.27472335e-2, 1.04584443e-2, 8.02941163e-3,
  -5.65949473e-3, -3.49717454e-3, -1.64973098e-3, -1.78805361e-4,
  9.02154502e-4, 1.61656283e-3, 1.99454554e-3, 2.10371989e-3,
  2.01182542e-3, 1.78371725e-3, 1.47640169e-3, 1.13992507e-3,
  8.23919506e-4, 5.54620202e-4, 3.43256425e-4, 1.56575398e-4
];

// The synthesis flow windows U with the prototype coefficients scaled by -8
// (spec Figure 12.3, "SBC Synthesis for 8 subbands").
const SYNTH_WINDOW_8_80 = Float64Array.from(SYNTH_PROTO_8_80, (c) => c * -8);

// Matrixing coefficients N[k][i] = cos((i + 0.5) * (k + 4) * PI / 8)
// (spec Figure 12.3). Computed once instead of storing a table.
const SYNTH_MATRIX_8 = Array.from({ length: 16 }, (_, k) =>
  Float64Array.from({ length: 8 }, (_, i) =>
    Math.cos(((i + 0.5) * (k + 4) * Math.PI) / 8)
  )
);

// CRC-8, polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x1D), initial value 0x0F,
// MSB-first, no final XOR (spec 12.6.1.1). The covered range is the frame
// header bytes after the syncword plus the scale factors (6 bytes for mSBC).
const CRC8_TABLE = new Uint8Array(256);
for (let byte = 0; byte < 256; byte++) {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 0x80 ? ((crc << 1) ^ 0x1d) & 0xff : (crc << 1) & 0xff;
  }
  CRC8_TABLE[byte] = crc;
}

function crc8(bytes) {
  let crc = 0x0f;
  for (const byte of bytes) {
    crc = CRC8_TABLE[crc ^ byte];
  }
  return crc;
}

// Bit allocation for one mono channel with the LOUDNESS method
// (spec 12.6.3.1). Returns the number of quantization bits per subband.
function calculateLoudnessBits(scaleFactors) {
  // NB: Array.from with a map function, so negative bitneed values survive
  // (TypedArray.prototype.map would return a typed array and wrap them).
  const bitneed = Array.from(scaleFactors, (sf, sb) => {
    if (sf === 0) {
      return -5;
    }
    const loudness = sf - LOUDNESS_OFFSETS_8[sb];
    return loudness > 0 ? Math.floor(loudness / 2) : loudness;
  });

  const maxBitneed = Math.max(0, ...bitneed);

  let bitcount = 0;
  let slicecount = 0;
  let bitslice = maxBitneed + 1;
  do {
    bitslice--;
    bitcount += slicecount;
    slicecount = 0;
    for (let sb = 0; sb < MSBC_SUBBANDS; sb++) {
      if (bitneed[sb] > bitslice + 1 && bitneed[sb] < bitslice + 16) {
        slicecount++;
      } else if (bitneed[sb] === bitslice + 1) {
        slicecount += 2;
      }
    }
  } while (bitcount + slicecount < MSBC_BITPOOL);

  if (bitcount + slicecount === MSBC_BITPOOL) {
    bitcount += slicecount;
    bitslice--;
  }

  const bits = bitneed.map((need) =>
    need < bitslice + 2 ? 0 : Math.min(need - bitslice, 16)
  );

  for (let sb = 0; bitcount < MSBC_BITPOOL && sb < MSBC_SUBBANDS; sb++) {
    if (bits[sb] >= 2 && bits[sb] < 16) {
      bits[sb]++;
      bitcount++;
    } else if (bitneed[sb] === bitslice + 1 && MSBC_BITPOOL > bitcount + 1) {
      bits[sb] = 2;
      bitcount += 2;
    }
  }

  for (let sb = 0; bitcount < MSBC_BITPOOL && sb < MSBC_SUBBANDS; sb++) {
    if (bits[sb] < 16) {
      bits[sb]++;
      bitcount++;
    }
  }

  return bits;
}

function clipInt16(value) {
  return value < -32768 ? -32768 : value > 32767 ? 32767 : value;
}

/**
 * Stateful mSBC decoder. The synthesis filter needs 10 blocks of history, so
 * decoding a continuous stream must go through a single instance (or through
 * decodeMsbcFrames, which creates one per call). Call reset() to drop the
 * filter history when the audio stream is interrupted.
 */
export class MsbcDecoder {
  #v = new Float64Array(160); // synthesis filter history (10 blocks of 16)
  #u = new Float64Array(80); // scratch for the windowed polyphase vector

  reset() {
    this.#v.fill(0);
  }

  /**
   * Decodes one 57-byte mSBC frame into 120 PCM16 samples.
   * Throws if the frame length is wrong, the syncword or the reserved header
   * bytes are invalid, or the CRC-8 check fails — callers must treat the
   * frame as lost and (for streams) reset or resync.
   */
  decodeFrame(frame) {
    if (frame.length !== MSBC_FRAME_LENGTH) {
      throw new Error(`mSBC frame must be ${MSBC_FRAME_LENGTH} bytes, got ${frame.length}`);
    }
    if (frame[0] !== MSBC_SYNCWORD) {
      throw new Error(`mSBC syncword mismatch: got 0x${frame[0].toString(16)}`);
    }
    if (frame[1] !== 0 || frame[2] !== 0) {
      throw new Error(`mSBC reserved header bytes must be 0, got 0x${frame[1].toString(16)} 0x${frame[2].toString(16)}`);
    }

    // 8 subbands * 4-bit scale factors, MSB first, right after the CRC byte.
    const scaleFactors = new Uint8Array(MSBC_SUBBANDS);
    for (let sb = 0; sb < MSBC_SUBBANDS; sb++) {
      scaleFactors[sb] = (frame[4 + (sb >> 1)] >> ((1 - (sb & 1)) * 4)) & 0x0f;
    }

    // CRC covers header bytes 1-2 and the scale factors, not the CRC byte 3.
    const crcData = [frame[1], frame[2], ...frame.subarray(4, 8)];
    if (frame[3] !== crc8(crcData)) {
      throw new Error("mSBC frame CRC-8 check failed");
    }

    const bits = calculateLoudnessBits(scaleFactors);
    const levels = bits.map((b) => (1 << b) - 1);
    // Plain Array: 2 ** (sf + 1) can exceed the uint8 range.
    const scaleFactorValues = Array.from(scaleFactors, (sf) => 2 ** (sf + 1));

    // Audio samples: blocks * bitpool = 15 * 26 = 390 bits, MSB first,
    // starting right after the scale factors (bit offset 64).
    const pcm = new Int16Array(MSBC_SAMPLES_PER_FRAME);
    const subbandSamples = new Float64Array(MSBC_SUBBANDS);
    let bitPos = 64;
    for (let blk = 0; blk < MSBC_BLOCKS; blk++) {
      for (let sb = 0; sb < MSBC_SUBBANDS; sb++) {
        const level = levels[sb];
        if (level === 0) {
          subbandSamples[sb] = 0;
          continue;
        }
        let sample = 0;
        for (let bit = 0; bit < bits[sb]; bit++) {
          sample = (sample << 1) | ((frame[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
          bitPos++;
        }
        // Reconstruction of the subband sample (spec 12.6.4).
        subbandSamples[sb] = scaleFactorValues[sb] * ((2 * sample + 1) / level - 1);
      }
      this.#synthesizeBlock(subbandSamples, pcm, blk * MSBC_SUBBANDS);
    }
    return pcm;
  }

  // Polyphase synthesis filter for 8 subbands (spec 12.6.6 / Figure 12.3):
  // turns 8 subband samples into 8 PCM samples, keeping history in this.#v.
  #synthesizeBlock(s, pcm, pcmOffset) {
    const v = this.#v;
    const u = this.#u;

    // Shifting: keep the last 10 matrix outputs (160 values).
    for (let i = 159; i >= 16; i--) {
      v[i] = v[i - 16];
    }

    // Matrixing.
    for (let k = 0; k < 16; k++) {
      const matrixRow = SYNTH_MATRIX_8[k];
      let acc = 0;
      for (let i = 0; i < 8; i++) {
        acc += matrixRow[i] * s[i];
      }
      v[k] = acc;
    }

    // Build the 80-value vector U from the 160-value history.
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 8; j++) {
        u[i * 16 + j] = v[i * 32 + j];
        u[i * 16 + 8 + j] = v[i * 32 + 24 + j];
      }
    }

    // Window by the prototype coefficients and sum the 10 taps per sample.
    for (let j = 0; j < 8; j++) {
      let acc = 0;
      for (let tap = 0; tap < 10; tap++) {
        acc += u[j + 8 * tap] * SYNTH_WINDOW_8_80[j + 8 * tap];
      }
      pcm[pcmOffset + j] = clipInt16(Math.round(acc));
    }
  }
}

/**
 * Convenience wrapper for decoding a single standalone frame with a fresh
 * (zeroed) filter history. For a continuous stream prefer MsbcDecoder or
 * decodeMsbcFrames — the synthesis filter carries 10 blocks of history, so
 * decoding frame N of a stream standalone does not match stream decoding.
 */
export function decodeMsbcFrame(frame) {
  return new MsbcDecoder().decodeFrame(frame);
}

/**
 * Decodes a buffer of concatenated 57-byte mSBC frames into PCM16LE mono
 * 16 kHz samples (240 bytes per frame). A trailing partial frame
 * (data.length % 57 !== 0) is silently ignored. Any invalid frame (bad
 * length, syncword, reserved bytes or CRC) throws, aborting the whole
 * decode — the runtime is expected to re-sync the capture on error.
 */
export function decodeMsbcFrames(data) {
  const frameCount = Math.floor(data.length / MSBC_FRAME_LENGTH);
  const pcm = Buffer.alloc(frameCount * MSBC_SAMPLES_PER_FRAME * 2);
  if (frameCount === 0) {
    return pcm;
  }

  const decoder = new MsbcDecoder();
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frame = data.subarray(
      frameIndex * MSBC_FRAME_LENGTH,
      (frameIndex + 1) * MSBC_FRAME_LENGTH
    );
    let samples;
    try {
      samples = decoder.decodeFrame(frame);
    } catch (error) {
      throw new Error(`mSBC frame ${frameIndex}: ${error.message}`);
    }
    for (let i = 0; i < samples.length; i++) {
      pcm.writeInt16LE(samples[i], (frameIndex * MSBC_SAMPLES_PER_FRAME + i) * 2);
    }
  }
  return pcm;
}
