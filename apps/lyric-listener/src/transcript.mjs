// Filters recognizer output before it becomes an stt_hypothesis. Shared by
// every capture mode (whisper-stream and channel select), since both pipe
// through stdin.mjs.

// Non-speech annotations whisper emits for music, applause, silence:
// "[BLANK_AUDIO]", "(music)", "*applause*", "♪".
const NON_SPEECH_RE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g;

// Whole transcripts whisper invents from near-silence or noise. Real lyrics
// always come with more words around them, so dropping these only when they
// are the ENTIRE transcript costs nothing.
const HALLUCINATIONS = new Set([
  "you",
  "thank you",
  "thanks",
  "thank you very much",
  "thanks for watching",
  "thank you for watching",
  "thank you so much for watching",
  "bye",
]);

/**
 * The transcript with non-speech annotations removed, or "" when nothing
 * real is left.
 * @param {string} text
 */
export function cleanTranscript(text) {
  const t = text.replace(NON_SPEECH_RE, " ").replace(/\s+/g, " ").trim();
  const key = t.toLowerCase().replace(/[^a-z' ]/g, "").replace(/\s+/g, " ").trim();
  if (!key || HALLUCINATIONS.has(key)) return "";
  return t;
}
