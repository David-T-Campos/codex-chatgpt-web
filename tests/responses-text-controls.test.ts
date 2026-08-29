import { expect, test } from "bun:test";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { parseRequest } from "../src/responses/parser";

const capabilities = {
  localToolsEnabled: true,
  solAvailable: true,
  proAvailable: true,
};

function request(text?: unknown) {
  return parseRequest({
    model: "chatgpt-web/high",
    stream: true,
    instructions: "Follow the native Codex contract.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Return the result." }] }],
    ...(text === undefined ? {} : { text }),
  });
}

test("Responses text verbosity survives parsing and reaches the Web transport contract", () => {
  for (const verbosity of ["low", "medium", "high"] as const) {
    const parsed = request({ verbosity });
    expect(parsed.options.verbosity).toBe(verbosity);
    const compiled = compileChatGptWebPrompt(parsed, capabilities, "turn_12345678901234567890123456789012");
    expect(compiled.text).toContain(`Codex requested ${verbosity} response verbosity.`);
  }
});

test("strict Responses json_schema format survives parsing without rewriting the schema", () => {
  const schema = {
    type: "object",
    properties: {
      answer: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["answer", "confidence"],
    additionalProperties: false,
  };
  const parsed = request({
    verbosity: "low",
    format: { type: "json_schema", name: "answer_payload", strict: true, schema },
  });
  expect(parsed.options.outputFormat).toEqual({
    type: "json_schema",
    name: "answer_payload",
    strict: true,
    schema,
  });
  const compiled = compileChatGptWebPrompt(parsed, capabilities, "turn_12345678901234567890123456789012");
  expect(compiled.text).toContain("Codex requested a strict JSON-schema final answer named answer_payload.");
  expect(compiled.text).toContain(JSON.stringify(schema));
  expect(compiled.text).toContain("one JSON value");
  expect(compiled.text).toContain("Do not wrap it in a Markdown code fence");
});

test("non-strict json_schema is preserved as a best-effort format contract", () => {
  const parsed = request({
    format: { type: "json_schema", name: "item", strict: false, schema: { type: "string" } },
  });
  expect(parsed.options.outputFormat?.strict).toBeFalse();
  const compiled = compileChatGptWebPrompt(parsed, capabilities, "turn_12345678901234567890123456789012");
  expect(compiled.text).toContain("Codex requested a JSON-schema final answer named item.");
});

test("absent or unknown Responses text controls do not invent output constraints", () => {
  const absent = request();
  const unknown = request({ verbosity: "extreme", format: { type: "text" } });
  expect(absent.options.verbosity).toBeUndefined();
  expect(absent.options.outputFormat).toBeUndefined();
  expect(unknown.options.verbosity).toBeUndefined();
  expect(unknown.options.outputFormat).toBeUndefined();
  const compiled = compileChatGptWebPrompt(absent, capabilities, "turn_12345678901234567890123456789012");
  expect(compiled.text).not.toContain("Codex requested low response verbosity.");
  expect(compiled.text).not.toContain("JSON-schema final answer");
});

test("multipart Web transport carries the same native output controls in the commit message", () => {
  const parsed = request({
    verbosity: "high",
    format: {
      type: "json_schema",
      name: "result",
      strict: true,
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    },
  });
  const compiled = compileChatGptWebPrompt(
    parsed,
    capabilities,
    "turn_12345678901234567890123456789012",
    { experimentalMultipartParts: 2 },
  );
  expect(compiled.multipart?.commit).toContain("Codex requested high response verbosity.");
  expect(compiled.multipart?.commit).toContain("strict JSON-schema final answer named result");
});
