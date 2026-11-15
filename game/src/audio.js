// DUSTLINE — threejs-fps-02
// Tanpa import three, tanpa file audio: semua isyarat disintesis dari
// noise burst lewat filter dan osilator nada. Semua metode sfx diam total
// (no-op) sebelum unlockAudio() berhasil dan context berjalan, supaya
// mode headless atau tangkapan layar tanpa gesture tidak pernah throw.

let audioCtx = null;
let masterGain = null;
let noiseBuf = null;

function audioConstructor() {
  if (typeof window !== 'undefined') {
    return window.AudioContext || window.webkitAudioContext || null;
  }
  if (typeof AudioContext !== 'undefined') return AudioContext;
  return null;
}

export function unlockAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }
  const AC = audioConstructor();
  if (!AC) return null;
  try {
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(audioCtx.destination);
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch (err) {
    audioCtx = null;
    masterGain = null;
  }
  return audioCtx;
}

// True hanya bila context ada dan sedang berjalan.
function live() {
  return !!(audioCtx && masterGain && audioCtx.state === 'running');
}

function getNoise(ctx) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 1);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// Ledakan noise singkat lewat filter, dengan amplop turun eksponensial.
function burst({ dur = 0.15, type = 'lowpass', freq = 1200, q = 0.8, gain = 0.5, at = 0 } = {}) {
  if (!live()) return;
  const t0 = audioCtx.currentTime + at;
  const src = audioCtx.createBufferSource();
  src.buffer = getNoise(audioCtx);
  src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// Nada osilator tunggal, boleh meluncur ke frekuensi lain (to).
function tone({ freq = 440, to = null, dur = 0.12, type = 'sine', gain = 0.3, at = 0 } = {}) {
  if (!live()) return;
  const t0 = audioCtx.currentTime + at;
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  // Tembakan beda karakter per senjata: P9 renyah, VK-9 cepat,
  // AR-77 dalam, LR-90 besar dengan ekor panjang.
  shot(key) {
    if (!live()) return;
    if (key === 'LR-90') {
      burst({ dur: 0.5, type: 'lowpass', freq: 500, gain: 0.9 });
      tone({ freq: 110, to: 45, dur: 0.4, type: 'sine', gain: 0.7 });
      burst({ dur: 0.12, type: 'highpass', freq: 2500, gain: 0.4 });
    } else if (key === 'AR-77') {
      burst({ dur: 0.16, type: 'bandpass', freq: 900, q: 1.2, gain: 0.7 });
      tone({ freq: 150, to: 70, dur: 0.14, type: 'triangle', gain: 0.5 });
    } else if (key === 'VK-9') {
      burst({ dur: 0.09, type: 'bandpass', freq: 1600, q: 1.0, gain: 0.55 });
      tone({ freq: 220, to: 110, dur: 0.08, type: 'square', gain: 0.25 });
    } else {
      burst({ dur: 0.1, type: 'highpass', freq: 1800, gain: 0.5 });
      tone({ freq: 190, to: 90, dur: 0.09, type: 'square', gain: 0.3 });
    }
  },

  dryFire() {
    tone({ freq: 1400, dur: 0.03, type: 'square', gain: 0.15 });
  },

  // Hitmarker: centang nada tinggi ganda.
  hit() {
    tone({ freq: 1500, dur: 0.05, type: 'sine', gain: 0.3 });
    tone({ freq: 2000, dur: 0.04, type: 'sine', gain: 0.2, at: 0.05 });
  },

  // Kill: dua nada naik.
  kill() {
    tone({ freq: 880, dur: 0.09, type: 'sine', gain: 0.35 });
    tone({ freq: 1318, dur: 0.14, type: 'sine', gain: 0.35, at: 0.09 });
  },

  // Terkena tembak: debuk rendah.
  hurt() {
    tone({ freq: 120, to: 60, dur: 0.18, type: 'sine', gain: 0.6 });
    burst({ dur: 0.12, type: 'lowpass', freq: 300, gain: 0.4 });
  },

  // Reload: tiga klik logam berurutan.
  reload() {
    tone({ freq: 900, dur: 0.03, type: 'square', gain: 0.2 });
    tone({ freq: 600, dur: 0.03, type: 'square', gain: 0.2, at: 0.18 });
    tone({ freq: 1100, dur: 0.04, type: 'square', gain: 0.25, at: 0.4 });
  },

  // Bunyi bip; high = true untuk nada yang lebih tinggi.
  beep(high = false) {
    tone({ freq: high ? 1320 : 880, dur: 0.09, type: 'sine', gain: 0.3 });
  },

  // Plant: dua bip pendek lalu satu bip panjang lebih tinggi.
  plant() {
    tone({ freq: 990, dur: 0.07, type: 'sine', gain: 0.3 });
    tone({ freq: 990, dur: 0.07, type: 'sine', gain: 0.3, at: 0.15 });
    tone({ freq: 1320, dur: 0.12, type: 'sine', gain: 0.3, at: 0.3 });
  },

  // Ledakan: gemuruh lowpass panjang + sub-bass jatuh + desis awal.
  explosion() {
    burst({ dur: 0.9, type: 'lowpass', freq: 420, gain: 1.0 });
    tone({ freq: 70, to: 30, dur: 0.8, type: 'sine', gain: 0.9 });
    burst({ dur: 0.3, type: 'highpass', freq: 3000, gain: 0.3 });
  },

  // Menang ronde: arpeggio naik empat nada.
  roundWin() {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.35, at: i * 0.11 });
    });
  },

  // Kalah ronde: arpeggio turun empat nada.
  roundLose() {
    [392, 330, 262, 196].forEach((f, i) => {
      tone({ freq: f, dur: 0.18, type: 'triangle', gain: 0.3, at: i * 0.12 });
    });
  },

  // Beli di buy menu: denting koin dua nada.
  buy() {
    tone({ freq: 988, dur: 0.07, type: 'sine', gain: 0.3 });
    tone({ freq: 1319, dur: 0.12, type: 'sine', gain: 0.3, at: 0.08 });
  },
};
