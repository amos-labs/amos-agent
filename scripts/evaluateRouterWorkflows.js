import { readFile } from "node:fs/promises";
import {
  LocalIntelligenceRouter
} from "../src/model/intelligenceRouter.js";
import { taskWorkflowCatalog } from "../src/workflows.js";

const dataset = JSON.parse(await readFile(
  new URL("../evals/router-workflows-v1.json", import.meta.url),
  "utf8"
));
const router = new LocalIntelligenceRouter({
  baseUrl: process.env.AMOS_ROUTER_BASE_URL || "http://127.0.0.1:11435",
  timeoutMs: Number(process.env.AMOS_ROUTER_EVAL_TIMEOUT_MS || 15_000)
});
const workflows = taskWorkflowCatalog();
const results = [];

for (const item of dataset.cases || []) {
  try {
    const actual = await router.classify({
      messages: [{ role: "user", content: item.task }],
      workflows
    });
    results.push({
      id: item.id,
      expectedClass: item.minimum_class,
      actualClass: actual.minimumClass,
      expectedWorkflow: item.workflow,
      actualWorkflow: actual.workflow,
      classCorrect: actual.minimumClass === item.minimum_class,
      workflowCorrect: actual.workflow === item.workflow,
      latencyMs: actual.latencyMs
    });
  } catch (error) {
    results.push({
      id: item.id,
      expectedClass: item.minimum_class,
      actualClass: null,
      expectedWorkflow: item.workflow,
      actualWorkflow: null,
      classCorrect: false,
      workflowCorrect: false,
      error: String(error?.message || error)
    });
  }
}

const total = results.length || 1;
const completed = results.filter((item) => !item.error);
const classAccuracy = results.filter((item) => item.classCorrect).length / total;
const workflowAccuracy = results.filter((item) => item.workflowCorrect).length / total;
const jointAccuracy = results.filter((item) =>
  item.classCorrect && item.workflowCorrect
).length / total;
const summary = {
  schema: dataset.schema,
  version: dataset.version,
  cases: results.length,
  classAccuracy,
  workflowAccuracy,
  jointAccuracy,
  averageLatencyMs: average(results.map((item) => item.latencyMs)),
  failures: results.filter((item) => !item.classCorrect || !item.workflowCorrect)
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (completed.length === 0) {
  process.stderr.write(
    "AMOS Router evaluation could not reach a running local router; no accuracy conclusion was produced.\n"
  );
  process.exitCode = 2;
} else {
  const minimumClassAccuracy = Number(process.env.AMOS_ROUTER_MIN_CLASS_ACCURACY || 0.85);
  const minimumWorkflowAccuracy = Number(process.env.AMOS_ROUTER_MIN_WORKFLOW_ACCURACY || 0.85);
  const minimumJointAccuracy = Number(process.env.AMOS_ROUTER_MIN_JOINT_ACCURACY || 0.8);
  if (
    classAccuracy < minimumClassAccuracy ||
    workflowAccuracy < minimumWorkflowAccuracy ||
    jointAccuracy < minimumJointAccuracy
  ) {
    process.exitCode = 1;
  }
}

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (finite.length === 0) return null;
  return Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}
