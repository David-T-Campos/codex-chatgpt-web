import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ChatGptCompletionAuditGate,
  chatGptStoppedThinkingCompletionSentinel,
  chatGptStoppedThinkingRecoveryPrompt,
} from "../src/adapters/chatgpt-web/continuation";

test("Stopped-thinking recovery keeps the same task ledger and capability", () => {
  const traceId = "abc123def456";
  const recovery = chatGptStoppedThinkingRecoveryPrompt(traceId);
  expect(recovery.sentinel).toBe(chatGptStoppedThinkingCompletionSentinel(traceId));
  expect(recovery.text).toContain("SAME active Codex turn");
  expect(recovery.text).toContain("same turn_token");
  expect(recovery.text).toContain("Do not restart the task");
  expect(recovery.text).toContain("Stopped thinking");
  expect(recovery.text).toContain(recovery.sentinel);
  expect(() => chatGptStoppedThinkingCompletionSentinel("bad trace id")).toThrow("trace id is invalid");
});

test("private completion sentinel is suppressed while real recovery text passes through", () => {
  const sentinel = chatGptStoppedThinkingCompletionSentinel("abc123def456");
  const completed = new ChatGptCompletionAuditGate(sentinel);
  expect(completed.push(sentinel.slice(0, 17))).toBe("");
  expect(completed.push(sentinel.slice(17))).toBe("");
  expect(completed.finish()).toEqual({ complete: true, delta: "" });

  const continued = new ChatGptCompletionAuditGate(sentinel);
  expect(continued.push("C")).toBe("");
  expect(continued.push("ontinuing the remaining verification now.")).toBe(
    "Continuing the remaining verification now.",
  );
  expect(continued.push(" Done.")).toBe(" Done.");
  expect(continued.finish()).toEqual({ complete: false, delta: "" });
});

test("browser integration permits exactly one event-driven recovery and no elapsed-time audit", () => {
  const source = readFileSync(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url), "utf8");
  expect(source).toContain("chatGptStoppedThinkingRecoveryPrompt");
  expect(source).toContain("startStoppedThinkingRecoveryRound");
  expect(source).toContain("stoppedThinkingRecoveryAttempted");
  expect(source).toContain("!turn.compaction && !turn.captureLunaCheckpoint");
  expect(source).not.toContain("chatGptLongTurnNeedsAudit");
  expect(source).not.toContain("CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS");
  expect(source).not.toContain("MAX_CHATGPT_WEB_CONTINUATION_ROUNDS");
  expect(source).not.toContain("long_turn_completion");
  expect(source).not.toContain("startContinuationRound");

  const start = source.indexOf("const startStoppedThinkingRecoveryRound");
  const end = source.indexOf("for (;;) {", start);
  const recovery = source.slice(start, end);
  expect(recovery).toContain("this.attachPrompt(");
  expect(recovery).toContain("this.sendAttachedPrompt(");
  expect(recovery).not.toContain("turn.onSendActivated");
  expect(recovery).not.toContain("turn.prepare(");
});
