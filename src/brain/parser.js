// Splits a streaming agent reply of the form
//   SAY: spoken words...
//   SCREEN:
//   monitor contents...
// into a "say" channel (speech + transcript) and a "screen" channel (monitor),
// emitting deltas as chunks arrive, even when a marker is split across chunks.

const SCREEN_MARKER = /(^|\n)\s*SCREEN:[ \t]*\n?/;
const SAY_PREFIX = /^\s*SAY:\s*/;
// Longest suffix of the say buffer that could still turn into the SCREEN marker.
const PARTIAL_MARKER = /\n?\s*S?C?R?E?E?N?:?$/;

export class ReplyParser {
  constructor({ onSay = () => {}, onScreen = () => {}, onSentence = () => {} } = {}) {
    this.onSay = onSay;
    this.onScreen = onScreen;
    this.onSentence = onSentence;
    this.raw = '';
    this.say = '';
    this.screen = '';
    this.inScreen = false;
    this.sentenceBuf = '';
  }

  push(chunk) {
    if (!chunk) return;
    this.raw += chunk;
    if (this.inScreen) {
      this.#emitScreen(chunk);
      return;
    }
    const m = this.raw.match(SCREEN_MARKER);
    if (m) {
      const before = this.raw.slice(0, m.index + m[1].length);
      this.#syncSay(before, true);
      this.inScreen = true;
      // The newline after "SCREEN:" may not have arrived yet; drop it when it does.
      this.skipLead = !m[0].endsWith('\n');
      this.#flushSentence();
      this.#emitScreen(this.raw.slice(m.index + m[0].length));
      return;
    }
    // Hold back anything that might be the beginning of "SCREEN:".
    const tail = this.raw.match(PARTIAL_MARKER);
    const safe = tail && tail[0].trim() ? this.raw.slice(0, tail.index) : this.raw;
    this.#syncSay(safe, false);
  }

  end() {
    if (!this.inScreen) this.#syncSay(this.raw, true);
    this.#flushSentence();
    return { say: this.say.trim(), screen: this.screen.replace(/\s+$/, '') };
  }

  #syncSay(text, final) {
    let next = text.replace(SAY_PREFIX, '');
    // "SAY" can itself arrive split across chunks; don't leak a partial prefix.
    if (!final && /^\s*S(A(Y)?)?$/.test(next)) next = '';
    if (next.length <= this.say.length) return;
    const delta = next.slice(this.say.length);
    this.say = next;
    this.onSay(delta);
    this.sentenceBuf += delta;
    let idx;
    while ((idx = this.sentenceBuf.search(/[.!?](\s|$)/)) !== -1 && /\s/.test(this.sentenceBuf[idx + 1] ?? '')) {
      this.onSentence(this.sentenceBuf.slice(0, idx + 1).trim());
      this.sentenceBuf = this.sentenceBuf.slice(idx + 1);
    }
  }

  #flushSentence() {
    const s = this.sentenceBuf.trim();
    if (s) this.onSentence(s);
    this.sentenceBuf = '';
  }

  #emitScreen(delta) {
    if (this.skipLead && delta) {
      if (/[^ \t]/.test(delta)) this.skipLead = false; // saw the newline or real content
      delta = delta.replace(/^[ \t]*\n?/, '');
    }
    if (!delta) return;
    this.screen += delta;
    this.onScreen(delta);
  }
}
