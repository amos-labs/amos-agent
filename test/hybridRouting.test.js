import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HYBRID_ROUTING,
  HybridRoutingClient,
  sanitizeHybridRouting
} from "../src/model/hybridRouting.js";

const localContract = Object.freeze({
  status: "qualified",
  grants: {
    modalities: ["text"],
    capabilities: ["tool-selection"]
  },
  limits: { contextTokens: 262_144 }
});

test("hybrid routing is off by default and invalid recipes sanitize safely", () => {
  assert.equal(DEFAULT_HYBRID_ROUTING.enabled, false);
  assert.deepEqual(sanitizeHybridRouting({
    enabled: true,
    frontier: { provider: "unknown", model: "unsafe" },
    strategies: { routine: "regex-magic", deep: "local-review" }
  }), {
    enabled: true,
    localModel: "",
    frontier: { provider: "amos-hosted", model: "auto" },
    strategies: {
      routine: "local",
      balanced: "local",
      deep: "local-review",
      frontier: "frontier"
    }
  });
});

test("managed recipes preserve the hosted path and reuse one classifier decision", async () => {
  const managed = stubClient("managed");
  const local = stubClient("local");
  const router = stubRouter("balanced");
  const client = hybridClient({
    router,
    managed,
    local,
    strategies: { balanced: "managed" }
  });

  const result = await client.chat({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(result.message.content, "managed response");
  assert.equal(router.calls.length, 1);
  assert.equal(managed.calls.length, 1);
  assert.equal(managed.calls[0].preclassifiedRouting.minimumClass, "balanced");
  assert.equal(local.calls.length, 0);
});

test("routine work prefers a qualified local model and records its model usage", async () => {
  const managed = stubClient("managed");
  const local = stubClient("local");
  const frontier = stubClient("frontier");
  const events = [];
  const client = hybridClient({
    router: stubRouter("routine"),
    managed,
    local,
    frontier
  });

  const result = await client.chat({
    messages: [{ role: "user", content: "summarize this" }],
    onRoutingDecision: (event) => events.push(event)
  });

  assert.equal(result.message.content, "local response");
  assert.equal(local.calls.length, 1);
  assert.equal(frontier.calls.length, 0);
  assert.equal(managed.calls.length, 0);
  assert.equal(result.usage.model_usage[0].model, "qwen-local");
  assert.ok(events.some((event) =>
    event.status === "selected" && event.selectedProvider === "ollama"
  ));
});

test("an ineligible local route falls through frontier and then managed", async () => {
  const managed = stubClient("managed");
  const local = stubClient("local");
  const frontier = stubClient("frontier", { fail: new Error("frontier unavailable") });
  const events = [];
  const client = hybridClient({
    router: stubRouter("routine"),
    managed,
    local,
    frontier,
    localContract: { ...localContract, grants: { ...localContract.grants, modalities: ["text"] } }
  });

  const result = await client.chat({
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,eA==" } }] }],
    onRoutingDecision: (event) => events.push(event)
  });

  assert.equal(result.message.content, "managed response");
  assert.equal(local.calls.length, 0);
  assert.equal(frontier.calls.length, 1);
  assert.equal(managed.calls.length, 1);
  assert.ok(events.some((event) => event.reason === "local_model_missing_vision"));
});

test("deep work uses a local tool turn without asking a reviewer to recreate tool calls", async () => {
  const managed = stubClient("managed");
  const frontier = stubClient("frontier");
  const local = stubClient("local", {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }]
    }
  });
  const client = hybridClient({
    router: stubRouter("deep"),
    managed,
    local,
    frontier
  });

  const result = await client.chat({
    messages: [{ role: "user", content: "analyze the account" }],
    tools: [{ type: "function", function: { name: "lookup" } }]
  });

  assert.equal(result.message.tool_calls.length, 1);
  assert.equal(local.calls.length, 1);
  assert.equal(frontier.calls.length, 0);
  assert.equal(managed.calls.length, 0);
});

test("deep final answers combine a local draft with a tool-free frontier review", async () => {
  const managed = stubClient("managed");
  const local = stubClient("local");
  const frontier = stubClient("frontier", {
    message: { role: "assistant", content: "reviewed answer" }
  });
  const deltas = [];
  const client = hybridClient({
    router: stubRouter("deep"),
    managed,
    local,
    frontier
  });

  const result = await client.chat({
    messages: [{ role: "user", content: "think deeply" }],
    tools: [{ type: "function", function: { name: "lookup" } }],
    onDelta: (delta) => deltas.push(delta)
  });

  assert.equal(result.message.content, "reviewed answer");
  assert.equal(local.calls[0].onDelta, null);
  assert.deepEqual(frontier.calls[0].tools, []);
  assert.match(frontier.calls[0].messages.at(-1).content, /local response/);
  assert.equal(result.usage.model_usage.length, 2);
  assert.equal(result.usage.total_tokens, 6);
  assert.deepEqual(deltas, []);
});

test("a failed frontier review uses AMOS Hosted as the terminal reviewer", async () => {
  const managed = stubClient("managed", {
    message: { role: "assistant", content: "managed review" }
  });
  const local = stubClient("local");
  const frontier = stubClient("frontier", { fail: new Error("frontier unavailable") });
  const client = hybridClient({
    router: stubRouter("deep"),
    managed,
    local,
    frontier
  });

  const result = await client.chat({ messages: [{ role: "user", content: "think deeply" }] });

  assert.equal(result.message.content, "managed review");
  assert.equal(frontier.calls.length, 1);
  assert.equal(managed.calls.length, 1);
  assert.deepEqual(managed.calls[0].tools, []);
});

test("router failure returns directly to managed classification without a second local attempt", async () => {
  const managed = stubClient("managed");
  const client = hybridClient({
    router: { classify: async () => { throw new Error("router failed"); } },
    managed,
    local: stubClient("local")
  });

  await client.chat({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(managed.calls.length, 1);
  assert.equal(managed.calls[0].skipLocalRouting, true);
});

function hybridClient({
  router,
  managed,
  local,
  frontier = null,
  localContract: contract = localContract,
  strategies = {}
}) {
  return new HybridRoutingClient({
    router,
    policy: {
      enabled: true,
      strategies: {
        ...DEFAULT_HYBRID_ROUTING.strategies,
        ...strategies
      }
    },
    managed: { provider: "amos-hosted", model: "auto", client: managed },
    local: { provider: "ollama", model: "qwen-local", client: local, contract },
    frontier: frontier
      ? { provider: "kimi", model: "kimi-frontier", client: frontier }
      : null
  });
}

function stubRouter(minimumClass) {
  const calls = [];
  return {
    calls,
    async classify(input) {
      calls.push(input);
      return { minimumClass, source: "local-router" };
    }
  };
}

function stubClient(name, { fail = null, message = null } = {}) {
  const calls = [];
  return {
    calls,
    async chat(input) {
      calls.push(input);
      if (fail) throw fail;
      return {
        message: message || { role: "assistant", content: `${name} response` },
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        raw: { name }
      };
    }
  };
}
