#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

import { AgentLoop } from "../src/agentLoop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { AMOS_OPERATOR_CONSTITUTION, SYSTEM_PROMPT } from "../src/prompts.js";
import {
  CONSULTATIVE_SCENARIOS,
  CONSULTATIVE_OPERATOR_SUITE,
  DISCOVERABLE_LOOKUP,
  buildConsultativeEvalPrompt,
  scoreConsultativeResponse,
  summarizeConsultativeResults
} from "../src/evals/consultativeOperator.js";

const profile = process.env.AMOS_EVAL_PROFILE || "local-operator";
const model = process.env.AMOS_EVAL_MODEL || "ollama:amos-operator";
const baseUrl = process.env.AMOS_EVAL_BASE_URL || "http://127.0.0.1:11434/v1";
const apiKey = process.env.AMOS_EVAL_API_KEY || "ollama";
const outPath = process.argv[2] || "";

const modelClient = {
  async chat({ messages, tools = [] }) {
    const body = {
      model: model.replace(/^ollama:/, ""),
      temperature: 0,
      messages,
      ...(tools.length > 0 ? { tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || { type: "object", properties: {} }
        }
      })) } : {})
    };
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`eval model ${response.status}: ${await response.text()}`);
    }
    const payload = await response.json();
    return payload?.choices?.[0]?.message || { role: "assistant", content: "" };
  }
};

function registryFor(scenario) {
  const registry = new ToolRegistry();
  if (scenario.id === "discoverable-answer") {
    registry.register({
      name: DISCOVERABLE_LOOKUP.name,
      description: "Look up a current company fact. Use this instead of asking the user.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"]
      },
      async handler() {
        return { text: DISCOVERABLE_LOOKUP.result };
      }
    });
  }
  return registry;
}

const scored = [];
for (const scenario of CONSULTATIVE_SCENARIOS) {
  const loop = new AgentLoop({
    modelClient,
    registry: registryFor(scenario),
    systemPrompt: SYSTEM_PROMPT.includes(AMOS_OPERATOR_CONSTITUTION)
      ? SYSTEM_PROMPT
      : `${AMOS_OPERATOR_CONSTITUTION}\n\n${SYSTEM_PROMPT}`,
    workflowSelector: () => ({
      id: "consultative-eval",
      version: 1,
      source: "eval",
      title: "Consultative eval",
      summary: "Score consultative first-move behavior.",
      skills: [],
      steps: [],
      doneWhen: "A useful next move is stated"
    })
  });
  const events = [];
  const result = await loop.run(buildConsultativeEvalPrompt(scenario), {
    onEvent: (event) => events.push(event)
  });
  const text = [
    result?.text || "",
    ...events
      .filter((event) => event.type === "tool_end")
      .map((event) => event.outcome || event.summary || "")
  ].join("\n");
  const scoredCase = {
    ...scoreConsultativeResponse(scenario, text),
    excerpt: String(text).replace(/\s+/g, " ").trim().slice(0, 400)
  };
  scored.push(scoredCase);
  console.log(`${scoredCase.passed ? "pass" : "fail"}\t${scenario.id}\t${scoredCase.notes || "ok"}`);
}

const summary = {
  schema: "amos.consultative-operator-fixture",
  version: 1,
  suite: CONSULTATIVE_OPERATOR_SUITE,
  results: [summarizeConsultativeResults(profile, model, scored)]
};
if (outPath) {
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
}
const failed = scored.filter((item) => !item.passed).length;
console.log(`${scored.length - failed}/${scored.length} passed on ${profile} ${model}`);
process.exit(failed === 0 ? 0 : 1);
