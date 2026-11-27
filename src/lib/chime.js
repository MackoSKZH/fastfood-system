let ctx = null;
let unlocked = false;

function audioContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  return ctx;
}

export function unlockChime() {
  const audio = audioContext();
  if (!audio) return;
  unlocked = true;
  if (audio.state === "suspended") audio.resume().catch(() => {});
}

function tone(audio, frequency, start, duration, peak, type) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

export function playChime({ loud = false } = {}) {
  if (!unlocked) return false;
  const audio = audioContext();
  if (!audio) return false;
  const start = () => {
    const now = audio.currentTime;
    const peak = loud ? 0.55 : 0.22;
    const type = loud ? "triangle" : "sine";
    tone(audio, loud ? 880 : 784, now, 0.14, peak, type);
    tone(audio, loud ? 1175 : 1046, now + 0.13, 0.22, peak, type);
  };
  if (audio.state === "suspended") {
    audio.resume().then(start).catch(() => {});
  } else {
    start();
  }
  return true;
}
