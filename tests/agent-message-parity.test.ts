import { expect, test } from "bun:test";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { parseRequest } from "../src/responses/parser";

const capabilities = { localToolsEnabled: false, solAvailable: true, proAvailable: true };

function nativeRequest(agentContent: unknown = [{ type: "input_text", text: "child result" }]) {
  return {
    model: CHATGPT_WEB_MODEL_ID,
    stream: true,
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "human request" }] },
      {
        type: "agent_message",
        author: "agent_child_7",
        recipient: "agent_parent_1",
        content: agentContent,
      },
    ],
  };
}

test("plaintext native AgentMessage preserves author recipient and content through parser", () => {
  const parsed = parseRequest(nativeRequest());
  expect(parsed._opaqueMultiAgentV2Payload).toBeUndefined();
  expect(parsed.context.messages[0]).toMatchObject({ role: "user", content: "human request" });
  expect(parsed.context.messages[1]).toMatchObject({
    role: "agentMessage",
    author: "agent_child_7",
    recipient: "agent_parent_1",
    content: "child result",
  });
});

test("inline Web context serializes AgentMessage as a distinct native role", () => {
  const parsed = parseRequest(nativeRequest());
  const compiled = compileChatGptWebPrompt(parsed, capabilities);
  const encoded = compiled.text.match(/<codex_context_json>\n(.+)\n<\/codex_context_json>/s)?.[1];
  expect(encoded).toBeTruthy();
  const envelope = JSON.parse(encoded!) as { messages: Array<Record<string, unknown>> };
  expect(envelope.messages[0]).toEqual({ role: "user", content: "human request" });
  expect(envelope.messages[0]).not.toHaveProperty("author");
  expect(envelope.messages[0]).not.toHaveProperty("recipient");
  expect(envelope.messages[1]).toEqual({
    role: "agent_message",
    author: "agent_child_7",
    recipient: "agent_parent_1",
    content: "child result",
  });
  expect(compiled.text).toContain("agent_message messages are inter-agent inputs");
  expect(compiled.text).toContain("Exclude agent_message inputs");
});

test("multipart Web context preserves the same AgentMessage envelope", () => {
  const parsed = parseRequest(nativeRequest());
  const compiled = compileChatGptWebPrompt(parsed, capabilities, undefined, { experimentalMultipartParts: 2 });
  const records = compiled.multipart!.parts.flatMap(part => {
    const payload = JSON.parse(part) as { records: Array<Record<string, unknown>> };
    return payload.records;
  });
  const messageRecords = records
    .filter(record => record.kind === "message")
    .map(record => record.message as Record<string, unknown>);
  expect(messageRecords).toContainEqual({
    role: "agent_message",
    author: "agent_child_7",
    recipient: "agent_parent_1",
    content: "child result",
  });
});

test("AgentMessage does not invent missing routing identity or fallback content", () => {
  const parsed = parseRequest({
    model: CHATGPT_WEB_MODEL_ID,
    stream: true,
    input: [{ type: "agent_message", content: "" }],
  });
  expect(parsed.context.messages[0]).toMatchObject({ role: "agentMessage", content: "" });
  expect(parsed.context.messages[0]).not.toHaveProperty("author");
  expect(parsed.context.messages[0]).not.toHaveProperty("recipient");
  const compiled = compileChatGptWebPrompt(parsed, capabilities);
  expect(compiled.text).toContain('"role":"agent_message","content":""');
  expect(compiled.text).not.toContain("sub-agent message received");
});

test("encrypted provider-private AgentMessage still flags the fail-closed path", () => {
  const parsed = parseRequest(nativeRequest([
    { type: "encrypted_content", encrypted_content: "opaque-provider-ciphertext" },
  ]));
  expect(parsed._opaqueMultiAgentV2Payload).toBeTrue();
  expect(parsed.context.messages[1]).toMatchObject({
    role: "agentMessage",
    author: "agent_child_7",
    recipient: "agent_parent_1",
  });
});
