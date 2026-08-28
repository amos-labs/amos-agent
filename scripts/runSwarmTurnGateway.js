#!/usr/bin/env node
import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SwarmTurnOrchestrator } from "../src/research/swarmTurnGateway.js";
import { AMOS_MISSION_WORKER_CONTRACT } from "../src/research/missionWorkerProtocol.js";

const args = process.argv.slice(2);
const host = option("--host") || "127.0.0.1";
const port = integerOption("--port", 18_081, 1, 65_535);
const backendBaseUrl = option("--backend-url") || process.env.AMOS_QWEN_RESEARCH_URL;
const backendModel = option("--backend-model") || "amos-qwen38-27b-fp8";
const backendContextTokens = integerOption("--backend-context-tokens", 32_768, 4_096, 1_048_576);
const contextSafetyTokens = integerOption("--context-safety-tokens", 1_024, 128, 131_072);
const backendApiKey = process.env.AMOS_LOCAL_BENCHMARK_API_KEY || null;
const gatewayApiKey = process.env.AMOS_SWARM_GATEWAY_API_KEY || null;
const tracePath = option("--trace") ? resolve(option("--trace")) : null;

if (!backendBaseUrl) fail("--backend-url or AMOS_QWEN_RESEARCH_URL is required");
if (!isLoopback(host) && !gatewayApiKey) {
  fail("AMOS_SWARM_GATEWAY_API_KEY is required when listening beyond loopback");
}

const orchestrator = new SwarmTurnOrchestrator({
  backendBaseUrl,
  backendModel,
  backendApiKey,
  backendContextTokens,
  contextSafetyTokens,
  onTrace: tracePath ? appendTrace : null
});
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, {
        ok: true,
        service: "amos-swarm-turn-gateway",
        model: backendModel,
        protocols: {
          openAiChatCompletions: true,
          platformMissionWorker: AMOS_MISSION_WORKER_CONTRACT
        },
        authority: {
          planner: "swarm",
          executor: "amos-platform",
          verifier: "amos-platform-checker-waist"
        },
        context: {
          backendTokens: backendContextTokens,
          safetyTokens: contextSafetyTokens
        }
      });
    }
    if (request.method !== "POST" || !new Set([
      "/v1/chat/completions",
      "/chat/completions"
    ]).has(request.url)) {
      return json(response, 404, { error: { message: "Not found" } });
    }
    if (gatewayApiKey && bearerToken(request) !== gatewayApiKey) {
      return json(response, 401, { error: { message: "Unauthorized" } });
    }
    const body = await readJsonBody(request, 4 * 1024 * 1024);
    const completion = await orchestrator.complete(body, {
      signal: AbortSignal.timeout(3_600_000)
    });
    return json(response, 200, completion);
  } catch (error) {
    const status = error?.name === "AbortError" || error?.name === "TimeoutError" ? 504 : 400;
    return json(response, status, {
      error: {
        type: "amos_swarm_gateway_error",
        message: String(error?.message || error).slice(0, 2_000)
      }
    });
  }
});

server.requestTimeout = 3_610_000;
server.headersTimeout = 3_620_000;
server.listen(port, host, () => {
  console.log(`AMOS Swarm turn gateway listening on http://${host}:${port}`);
  console.log(`Backend: ${redactedEndpoint(backendBaseUrl)} · ${backendModel}`);
  if (tracePath) console.log(`Traces: ${tracePath}`);
});

async function appendTrace(trace) {
  await mkdir(dirname(tracePath), { recursive: true });
  await appendFile(tracePath, `${JSON.stringify(trace)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readJsonBody(request, maximumBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error("Request body exceeds the gateway limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ""));
  return match?.[1] || "";
}

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function redactedEndpoint(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function integerOption(name, fallback, minimum, maximum) {
  const raw = option(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function isLoopback(value) {
  return new Set(["127.0.0.1", "::1", "localhost"]).has(value);
}

function fail(message) {
  console.error(
    `${message}\n\n` +
    "Usage: node scripts/runSwarmTurnGateway.js --backend-url URL " +
    "[--backend-model MODEL] [--backend-context-tokens 32768] " +
    "[--context-safety-tokens 1024] [--host 127.0.0.1] [--port 18081] " +
    "[--trace FILE.jsonl]"
  );
  process.exit(2);
}
