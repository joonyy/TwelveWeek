// Generate a short three-note chime locally, without fetching an audio file.
export function playTimerChime(context) {
  const notes = [660, 880, 1046.5].map((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * 0.24;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + 0.22);
    return oscillator;
  });
  return () => {
    for (const oscillator of notes) {
      try {
        oscillator.stop();
      } catch {
        /* Already ended. */
      }
    }
  };
}

export function createTimerAlarm(onReady) {
  let context, interval, cancelChime;
  const ready = () => context?.state === "running";
  function prepare() {
    if (!context) {
      const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Audio) return false;
      try {
        context = new Audio();
        context.onstatechange = () => onReady(ready());
      } catch {
        return false;
      }
    }
    onReady(ready());
    return ready();
  }
  async function enable() {
    prepare();
    if (!context) return false;
    try {
      await context.resume();
    } catch {
      /* Show the visible fallback. */
    }
    onReady(ready());
    return ready();
  }
  function chime() {
    cancelChime?.();
    cancelChime = playTimerChime(context);
  }
  function stop() {
    clearInterval(interval);
    interval = null;
    cancelChime?.();
    cancelChime = null;
  }
  return {
    prepare,
    enable,
    ring() {
      stop();
      if (!ready()) return false;
      chime();
      interval = setInterval(() => {
        if (ready()) chime();
      }, 4000);
      return true;
    },
    preview() {
      stop();
      if (ready()) chime();
    },
    stop,
    dispose() {
      stop();
      if (context) {
        context.onstatechange = null;
        void context.close().catch(() => {});
        context = null;
      }
    },
  };
}
