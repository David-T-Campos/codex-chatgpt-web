import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS,
  MAX_CHATGPT_WEB_CONTINUATION_ROUNDS,
  ChatGptCompletionAuditGate,
  chatGptCompletionAuditSentinel,
  chatGptContinuationPrompt,
  chatGptLongTurnNeedsAudit,
} from "../src/adapters/chatgpt-web/continuation";

test("long Web turns receive a completion audit only after the conservative threshold", () => {
  expect(CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS).toBe(20 * 60_000);
  expect(chatGptLongTurnNeedsAudit(1_000, 1_000 + CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS - 1)).toBeFalse();
  expect(chatGptLongTurnNeedsAudit(1_000, 1_000 + CHATGPT_LONG_TURN_COMPLETION_AUDIT_AFTER_MS)).toBeTrue();
  expect(MAX_CHATGPT_WEB_CONTINUATION_ROUNDS).toBeGreaterThanOrEqual(4);
});

test("continuation prompt keeps the original Codex task and capability authoritative", () => {
  const traceId = "abc123def456";
  const stopped = chatGptContinuationPrompt(traceId, "stopped_thinking");
  const long = chatGptContinuationPrompt(traceId, "long_turn_completion");
  expect(stopped.sentinel).toBe(chatGptCompletionAuditSentinel(traceId));
  expect(stopped.text).toContain("SAME active Codex turn");
  expect(stopped.text).toContain("same turn_token");
  expect(stopped.text).toContain("Do not restart the task");
  expect(stopped.text).toContain("Stopped thinking");
  expect(stopped.text).toContain(stopped.sentinel);
  expect(long.text).toContain("explicit completion audit");
  expect(long.text).toContain("fully complete and verified");
  expect(() => chatGptCompletionAuditSentinel("bad trace id")).toThrow("trace id is invalid");
});

test("completion audit sentinel is private while real continuation text streams immediately after divergence", () => {
  const sentinel = chatGptCompletionAuditSentinel("abc123def456");
  const completed = new ChatGptCompletionAuditGate(sentinel);
  expect(completed.push("  ")).toBe("");
  expect(completed.push(sentinel.slice(0, 12))).toBe("");
  expect(completed.push(sentinel.slice(12))).toBe("");
  expect(completed.finish()).toEqual({ complete: true, delta: "" });

  const continued = new ChatGptCompletionAuditGate(sentinel);
  expect(continued.push("C")).toBe("");
  expect(continued.push("ontinuing the remaining verification now.")).toBe(
    "Continuing the remaining verification now.",
  );
  expect(continued.push(" Done.")).toBe(" Done.");
  expect(continued.finish()).toEqual({ complete: false, delta: "" });

  const short = new ChatGptCompletionAuditGate(sentinel);
  expect(short.push("CODEX")).toBe("");
  expect(short.finish()).toEqual({ complete: false, delta: "CODEX" });
});

test("browser worker integrates continuation without replaying the original accepted turn", () => {
  const source = readFileSync(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url), "utf8");
  expect(source).toContain("chatGptContinuationPrompt");
  expect(source).toContain("chatGptLongTurnNeedsAudit");
  expect(source).toContain("MAX_CHATGPT_WEB_CONTINUATION_ROUNDS");
  expect(source).toContain("startContinuationRound");
  expect(source).toContain("reuseConnector");
  const continuation = source.slice(
    source.indexOf("const startContinuationRound"),
    source.indexOf("for (;;) {", source.indexOf("const startContinuationRound")),
  );
  expect(continuation).toContain("this.attachPrompt(");
  expect(continuation).toContain("this.sendAttachedPrompt(");
  expect(continuation).not.toContain("turn.onSendActivated");
  expect(continuation).not.toContain("turn.prepare(");
});
