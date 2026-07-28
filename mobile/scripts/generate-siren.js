// Membuat file suara sirine sintetis (tanpa aset eksternal / bebas hak cipta) untuk notification channel Android.
// Jalankan sekali: node scripts/generate-siren.js
// Menghasilkan file WAV mono 16-bit PCM 44.1kHz berisi nada sirine ambulans bergantian (mirip siren di app.js/Web Audio).
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION_SEC = 4; // Android akan me-loop suara channel notifikasi selama notifikasi aktif
const OUT_DIR = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'alarm_sos.wav');

function generateSirenSamples() {
  const totalSamples = SAMPLE_RATE * DURATION_SEC;
  const samples = new Int16Array(totalSamples);
  const baseFreq = 700; // Hz
  const modFreq = 2; // kecepatan naik-turun (Hz) mirip sirine ambulans
  const modDepth = 250; // rentang naik-turun frekuensi
  const amplitude = 0.5 * 32767;

  let phase = 0;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const instantFreq = baseFreq + modDepth * Math.sin(2 * Math.PI * modFreq * t);
    phase += (2 * Math.PI * instantFreq) / SAMPLE_RATE;
    samples[i] = Math.round(Math.sin(phase) * amplitude);
  }
  return samples;
}

function writeWavFile(samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = SAMPLE_RATE * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const samples = generateSirenSamples();
const wavBuffer = writeWavFile(samples);
fs.writeFileSync(OUT_FILE, wavBuffer);
console.log(`[generate-siren] Berhasil membuat: ${OUT_FILE} (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
