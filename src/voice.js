// Web Speech API wrappers: push-to-talk recognition and per-agent speech synthesis.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupport = {
  listen: Boolean(Recognition),
  speak: 'speechSynthesis' in window,
};

export class PushToTalk {
  constructor({ onInterim = () => {}, onFinal = () => {}, onError = () => {}, onState = () => {} } = {}) {
    Object.assign(this, { onInterim, onFinal, onError, onState });
    this.active = false;
    this.heard = '';
    if (!Recognition) return;
    const rec = (this.rec = new Recognition());
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      this.heard = text.trim();
      this.onInterim(this.heard);
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.onError(e.error);
    };
    rec.onend = () => {
      this.active = false;
      this.onState(false);
      const text = this.heard;
      this.heard = '';
      if (text) this.onFinal(text);
    };
  }

  start() {
    if (!this.rec || this.active) return false;
    this.heard = '';
    try {
      this.rec.start();
      this.active = true;
      this.onState(true);
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (this.rec && this.active) this.rec.stop(); // fires onend -> onFinal
  }
}

export class Speaker {
  constructor() {
    this.muted = false;
    this.voices = [];
    if (!voiceSupport.speak) return;
    const load = () => {
      const all = speechSynthesis.getVoices();
      const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang));
      this.voices = en.length ? en : all;
    };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  voiceFor(index) {
    if (!this.voices.length) return null;
    return this.voices[(index * 3) % this.voices.length];
  }

  // Returns a promise that resolves when the utterance finishes (or immediately if muted).
  say(text, { index = 0, pitch = 1, rate = 1, onStart, onEnd } = {}) {
    if (!voiceSupport.speak || this.muted || !text) {
      onEnd?.();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.voiceFor(index);
      if (v) u.voice = v;
      u.pitch = pitch;
      u.rate = rate;
      u.onstart = () => onStart?.();
      u.onend = u.onerror = () => {
        onEnd?.();
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  get speaking() {
    return voiceSupport.speak && speechSynthesis.speaking;
  }

  cancel() {
    if (voiceSupport.speak) speechSynthesis.cancel();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) this.cancel();
    return this.muted;
  }
}
