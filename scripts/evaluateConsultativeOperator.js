#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

import { AMOS_OPERATOR_CONSTITUTION } from "../src/prompts.js";
import {
  CONSULTATIVE_SCENARIOS,
  CONSULTATIVE_OPERATOR_SUITE,
  buildConsultativeEvalPrompt,
  scoreConsultativeResponse,
  summarizeConsultativeResults
} from "../src/evals/consultativeOperator.js";

const profile = process.env.AMOS_EVAL_PROFILE || "local-operator";
const model = process.env.AMOS_EVAL_MODEL || "ollama:amos-operator";
const baseUrl = process.env.AMOS_EVAL_BASE_URL || "http://127.0.0.1:11434/v1";
const apiKey = process.env.AMOS_EVAL_API_KEY || "ollama";
const outPath = process.argv[2] || "";

async function chat(content) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model.replace(/^ollama:/, ""),
      temperature: 0,
      messages: [
        { role: "system", content: AMOS_OPERATOR_CONSTITUTION },
        { role: "user", content }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`eval model ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}

const scored = [];
for (const scenario of CONSULTATIVE_SCENARIOS) {
  const prompt = buildConsultativeEvalPrompt(scenario, AMOS_OPERATOR_CONSTITUTION);
  const text = await chat(prompt);
  const result = {
    ...scoreConsultativeResponse(scenario, text),
    excerpt: String(text).replace(/\s+/g, " ").trim().slice(0, 400)
  };
  scored.push(result);
  const mark = result.passed ? "pass" : "fail";
  console.log(`${mark}\t${scenario.id}\t${result.notes || "ok"}`);
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
