import { expect, test } from "bun:test";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { parseRequest } from "../src/responses/parser";

const capabilities = { localToolsEnabled: true, solAvailable: true, proAvailable: true };
const turnToken = "turn_12345678901234567890123456789012";

function agentRequest() {
  return parseRequest({
    model: CHATGPT_WEB_MODEL_ID,
    stream: true,
    input: [
      {
        type: "agent_message",
        author: "agent-child-7",
        recipient: "agent-parent-1",
        content: [{ type: "input_text", text: "CHILD_RESULT 42" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "ordinary user message" }],
      },
    ],
  });
}

function inlineMessages(text: string): Array<Record<string, unknown>> {
  const match = text.match(/<codex_context_json>\n([^\n]+)\n<\/codex_context_json>/);
  if (!match?.[1]) throw new Error("inline Codex context JSON missing");
  return (JSON.parse(match[1]) as { messages: Array<Record<string, unknown>> }).messages;
}

test("plaintext AgentMessage author and recipient survive the Responses parser", () => {
  const parsed = agentRequest();
  expect(parsed._opaqueMultiAgentV2Payload).toBeFalse();
  expect(parsed.context.messages[0]).toMatchObject({
    role: "user",
    content: "CHILD_RESULT 42",
    agentMessage: {
      author: "agent-child-7",
      recipient: "agent-parent-1",
    },
  });
  expect(parsed.context.messages[1]).toMatchObject({ role: "user", content: "ordinary user message" });
  expect(parsed.context.messages[1]).not.toHaveProperty("agentMessage");
});

test("inline Web context preserves AgentMessage as a distinct native semantic record", () => {
  const compiled = compileChatGptWebPrompt(agentRequest(), capabilities, turnToken);
  const messages = inlineMessages(compiled.text);
  expect(messages[0]).toEqual({
    role: "agent_message",
    author: "agent-child-7",
    recipient: "agent-parent-1",
    content: "CHILD_RESULT 42",
  });
  expect(messages[1]).toEqual({ role: "user", content: "ordinary user message" });
});

test("multipart Web context preserves AgentMessage identity without inventing it on users", () => {
  const compiled = compileChatGptWebPrompt(
    agentRequest(),
    capabilities,
    turnToken,
    { experimentalMultipartParts: 2 },
  );
  const messages = compiled.multipart!.parts.flatMap(part => {
    const decoded = JSON.parse(part) as { records: Array<Record<string, unknown>> };
    return decoded.records
      .filter(record => record.kind === "message")
      .map(record => record.message as Record<string, unknown>);
  });
  expect(messages[0]).toMatchObject({
    role: "agent_message",
    author: "agent-child-7",
    recipient: "agent-parent-1",
    content: "CHILD_RESULT 42",
  });
  expect(messages[1]).toEqual({ role: "user", content: "ordinary user message" });
});
