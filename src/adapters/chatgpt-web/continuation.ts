const TRACE_ID = /^[A-Za-z0-9_-]{6,128}$/;
const COMPLETION_SENTINEL_PREFIX = "CODEX_NATIVE_STOPPED_THINKING_COMPLETE_";

export function chatGptStoppedThinkingCompletionSentinel(traceId: string): string {
  if (!TRACE_ID.test(traceId)) throw new Error("ChatGPT continuation trace id is invalid");
  return `${COMPLETION_SENTINEL_PREFIX}${traceId}`;
}

/**
 * One private same-conversation recovery message for a durable ChatGPT `Stopped thinking`
 * state. It never replays the already accepted Codex request.
 */
export function chatGptStoppedThinkingRecoveryPrompt(
  traceId: string,
): { text: string; sentinel: string } {
  const sentinel = chatGptStoppedThinkingCompletionSentinel(traceId);
  return {
    sentinel,
    text: [
      "<codex_native_stopped_thinking_recovery>",
      "This is a private recovery check for the SAME active Codex turn, not a new user task.",
      "ChatGPT exposed a durable Stopped thinking state before the outer Codex turn could safely accept completion.",
      "Re-read the original Codex task and the immediately preceding work in this conversation. Preserve every completed tool effect, result, decision, and constraint.",
      "Do not restart the task, redo completed work, or repeat user-facing text that the preceding assistant response already returned.",
      "If local work is still required, keep using the already attached Codex Native tools and the same turn_token supplied by the prior Codex transport message. Never expose that token.",
      `If and only if the original Codex request is already fully complete and verified AND the preceding assistant output already contains the complete user-facing answer, reply with exactly ${sentinel} and nothing else.`,
      "Otherwise continue the unfinished work now and return only the missing continuation that should be appended to the same outer Codex response.",
      "Do not mention this recovery check, the execution boundary, the sentinel, or the transport in user-facing output.",
      "</codex_native_stopped_thinking_recovery>",
    ].join("\n"),
  };
}

/** Suppress only the private completion sentinel; real recovery text passes through. */
export class ChatGptCompletionAuditGate {
  private pending = "";
  private passthrough = false;

  constructor(readonly sentinel: string) {
    if (!sentinel.trim()) throw new Error("ChatGPT completion audit sentinel must not be empty");
  }

  push(delta: string): string {
    if (!delta) return "";
    if (this.passthrough) return delta;
    this.pending += delta;
    const candidate = this.pending.trimStart();
    if (!candidate || this.sentinel.startsWith(candidate)) return "";
    this.passthrough = true;
    const visible = this.pending;
    this.pending = "";
    return visible;
  }

  finish(): { complete: boolean; delta: string } {
    if (this.passthrough) return { complete: false, delta: "" };
    const pending = this.pending;
    this.pending = "";
    if (pending.trim() === this.sentinel) return { complete: true, delta: "" };
    this.passthrough = true;
    return { complete: false, delta: pending };
  }
}
