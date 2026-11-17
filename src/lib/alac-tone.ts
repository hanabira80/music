const SAMPLE_RATE = 44100;
const FRAME_SAMPLES = 352;
const TONE_HZ = 440;
const TONE_AMPLITUDE = 8000;

class BitWriter {
  private readonly bytes: number[] = [];
  private acc = 0;
  private filled = 0;

  write(value: number, bits: number) {
    for (let i = bits - 1; i >= 0; i -= 1) {
      this.acc = (this.acc << 1) | ((value >>> i) & 1);
      this.filled += 1;
      if (this.filled === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.filled = 0;
      }
    }
  }

  finish() {
    if (this.filled > 0) {
      this.acc <<= 8 - this.filled;
      this.bytes.push(this.acc);
    }
    return Buffer.from(this.bytes);
  }
}

function sampleAt(index: number) {
  return Math.round(Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE) * TONE_AMPLITUDE);
}

export function encodeAlacStereoFrame(samples: Int16Array) {
  const writer = new BitWriter();
  writer.write(1, 3);
  writer.write(0, 4);
  writer.write(0, 12);
  writer.write(0, 1);
  writer.write(0, 2);
  writer.write(1, 1);
  for (let i = 0; i < FRAME_SAMPLES; i += 1) {
    writer.write(samples[i * 2] & 0xffff, 16);
    writer.write(samples[i * 2 + 1] & 0xffff, 16);
  }
  writer.write(7, 3);
  return writer.finish();
}

export function alacToneFrames() {
  const packets = 375;
  const frames: Buffer[] = [];
  for (let packet = 0; packet < packets; packet += 1) {
    const samples = new Int16Array(FRAME_SAMPLES * 2);
    const start = packet * FRAME_SAMPLES;
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      const value = sampleAt(start + i);
      samples[i * 2] = value;
      samples[i * 2 + 1] = value;
    }
    frames.push(encodeAlacStereoFrame(samples));
  }
  return frames;
}

export const ALAC_FRAME_SAMPLES = FRAME_SAMPLES;
export const ALAC_SAMPLE_RATE = SAMPLE_RATE;
