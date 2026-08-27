import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidModelToolArguments,
  canonicalizeChatMessages,
  jsonObjectArgumentString
} from "../src/model/protocol.js";

test("empty or object tool arguments become a JSON object string", () => {
  assert.equal(jsonObjectArgumentString(""), "{}");
  assert.equal(jsonObjectArgumentString("  "), "{}");
  assert.equal(jsonObjectArgumentString(null), "{}");
  assert.equal(jsonObjectArgumentString({ engine: "finance" }), "{\"engine\":\"finance\"}");
  assert.equal(jsonObjectArgumentString("{\"path\":\".\"}"), "{\"path\":\".\"}");
  assert.equal(jsonObjectArgumentString("{"), "{}");
  assert.equal(jsonObjectArgumentString("[1]"), "{}");
});

test("outbound chat history rewrites empty tool arguments so Hosted can accept the turn", () => {
  const [message] = canonicalizeChatMessages([{
    role: "assistant",
    content: "",
    tool_calls: [{
      id: "call-53",
      type: "function",
      function: { name: "amos_list_engines", arguments: "" }
    }]
  }]);
  assert.equal(message.tool_calls[0].function.arguments, "{}");
});

test("blank tool arguments are stored as {} instead of rejected", () => {
  const response = {
    message: {
      role: "assistant",
      tool_calls: [{
        id: "call-1",
        function: { name: "amos_whoami", arguments: "" }
      }]
    }
  };
  assertValidModelToolArguments(response);
  assert.equal(response.message.tool_calls[0].function.arguments, "{}");
});
