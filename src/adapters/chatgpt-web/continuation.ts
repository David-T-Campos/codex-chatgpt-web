export const CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS = 20 * 60_000;
export const MAX_CHATGPT_WEB_CONTINUATION_ROUNDS = 8;

export type ChatGptContinuationReason = "stopped_thinking" | "long_turn_completion";

const TRACE_ID = /^[A-Za-z0-9_-]{6,128}$/;
const COMPLETION_SENTINEL_PREFIX = "CODEX_NATIVE_TURN_COMPLETE_";

export function chatGptCompletionAuditSentinel(traceId: string): string {
  if (!TRACE_ID.test(traceId)) throw new Error("ChatGPT continuation trace id is invalid");
  return `${COMPLETION_SENTINEL_PREFIX}${traceId}`;
}

export function chatGptLongTurnNeedsAudit(
  roundStartedAt: number,
  now = Date.now(),
  thresholdMs = CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS,
): boolean {
  if (!Number.isFinite(roundStartedAt) || !Number.isFinite(now)) {
    throw new Error("ChatGPT continuation timestamps must be finite");
  }
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new Error("ChatGPT continuation audit threshold must be a non-negative finite number");
  }
  return now - roundStartedAt >= thresholdMs;
}

/**
 * A private same-conversation follow-up. It never replaces or replays the accepted Codex request:
 * the already-owned Temporary Chat remains the task ledger and the existing turn-bound capability
 * remains authoritative for any local work that is still required.
 */
export function chatGptContinuationPrompt(
  traceId: string,
  reason: ChatGptContinuationReason,
): { text: string; sentinel: string } {
  const sentinel = chatGptCompletionAuditSentinel(traceId);
  const boundary = reason === "stopped_thinking"
    ? "ChatGPT exposed a durable Stopped thinking state before the outer Codex turn could safely accept completion."
    : "The preceding Web generation ran long enough that the outer Codex turn requires an explicit completion audit before it can accept completion.";
  const text = [
    "<codex_native_continuation>",
    "This is a private continuation check for the SAME active Codex turn, not a new user task.",
    boundary,
    "Re-read the original Codex task and the immediately preceding work in this conversation. Preserve every completed tool effect, result, decision, and constraint.",
    "Do not restart the task, redo completed work, or repeat user-facing text that the preceding assistant response already returned.",
    "If local work is still required, keep using the already attached Codex Native tools and the same turn_token supplied by the prior Codex transport message. Never expose that token.",
    `If and only if the original Codex request is fully complete and verified AND the preceding assistant output already contains the complete user-facing answer, reply with exactly ${sentinel} and nothing else.`,
    "Otherwise continue the unfinished work now and return only the missing continuation that should be appended to the same outer Codex response.",
    "Do not mention this continuation check, the execution boundary, the sentinel, or the transport in user-facing output.",
    "</codex_native_continuation>",
  ].join("\n");
  return { text, sentinel };
}

/**
 * Holds only the tiny prefix that could still be the private completion sentinel. Once the text
 * diverges, streaming becomes pass-through immediately. This keeps real continuation output live
 * without ever leaking a successful audit marker into the Codex answer.
 */
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
