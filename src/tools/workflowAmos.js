import { normalizeMcpToolResult } from "../mcp/amosMcpClient.js";
import { createHash } from "node:crypto";
import { measureToolSurface, sanitizeToolName } from "./registry.js";

const readTool = (name, remoteName, description) => ({
  name,
  source: "amos:workflow",
  toolkit: "core",
  readOnly: true,
  parallelSafe: true,
  description,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, context) {
    return normalizeMcpToolResult(
      await context.amosClient.callTool(
        remoteName,
        {},
        { signal: context.signal },
      ),
    );
  },
});

/** Distinct company runtime: no fallback to unrestricted engine discovery. */
export function createWorkflowAmosTools() {
  return [
    readTool(
      "amos_whoami",
      "whoami",
      "Read the current company, user and scopes.",
    ),
    readTool(
      "amos_get_operator_context",
      "get_operator_context",
      "Read selected workflows and concise status of their Mission/Automation specialists. Coordinate outcomes; do not poll unchanged work.",
    ),
    readTool(
      "amos_get_workflow_workspace",
      "get_workflow_workspace",
      "Read current workflow configuration, setup guidance and separately suggested workflows. Recommendations are not enabled workflows.",
    ),
    {
      name: "amos_load_workflow_tools",
      source: "amos:workflow",
      toolkit: "core",
      readOnly: true,
      description:
        "Load the exact permitted tools for one selected workflow. If requires_toolkit is true, choose one returned toolkit. Tools stay inside this workflow; unrelated engines are unavailable.",
      parameters: {
        type: "object",
        properties: {
          workflow_key: { type: "string" },
          toolkit: { type: "string" },
        },
        required: ["workflow_key"],
        additionalProperties: false,
      },
      async handler(args, context) {
        const payload = normalizeMcpToolResult(
          await context.amosClient.callTool("get_workflow_tools", args, {
            signal: context.signal,
          }),
        );
        if (payload.ok === false || payload.requires_toolkit) return payload;
        if (
          payload.schema !== "amos.workflow_tools.v1" ||
          payload.workflow_key !== args.workflow_key
        )
          throw new Error(
            "AMOS returned a mismatched workflow capability snapshot",
          );
        const tools = Array.isArray(payload.tools) ? payload.tools : [];
        const definitions = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));
        if (
          tools.length > 24 ||
          measureToolSurface(definitions).schemaBytes > 96_000
        )
          throw new Error("Choose a smaller workflow toolkit");
        const toolkit = `amos-workflow:${args.workflow_key}:${args.toolkit || "all"}`;
        // Keep one bounded workflow toolkit in the foreground. Retaining old
        // inactive schemas also causes collisions when switching all → toolkit.
        context.registry.unregisterWhere((tool) =>
          tool.toolkit.startsWith("amos-workflow:"),
        );
        const registered = [];
        for (const tool of tools) {
          if (
            typeof tool.name !== "string" ||
            !tool.inputSchema ||
            typeof tool.inputSchema !== "object"
          )
            continue;
          const rawName = `amos_workflow_${args.workflow_key}_${tool.name}`;
          const name =
            rawName.length <= 64
              ? sanitizeToolName(rawName)
              : `${sanitizeToolName(rawName).slice(0, 51)}_${createHash("sha256").update(rawName).digest("hex").slice(0, 12)}`;
          registered.push(name);
          context.registry.register({
            name,
            source: "amos:workflow",
            toolkit,
            remoteName: tool.name,
            description:
              tool.description ||
              `Run ${tool.name} inside ${args.workflow_key}.`,
            parameters: tool.inputSchema,
            readOnly: tool.annotations?.readOnlyHint === true,
            parallelSafe: tool.annotations?.readOnlyHint === true,
            async handler(toolArgs, inner) {
              const mission = tool.name === "create_mission";
              const control = tool.workflow_control === true;
              const result = await inner.amosClient.callTool(
                control ? tool.name : "call_workflow_tool",
                mission
                  ? { ...toolArgs, workflow_key: args.workflow_key }
                  : control
                    ? toolArgs || {}
                    : {
                        workflow_key: args.workflow_key,
                        operation: tool.name,
                        arguments: toolArgs || {},
                      },
                { signal: inner.signal },
              );
              return normalizeMcpToolResult(result);
            },
          });
        }
        const activation = context.registry.activateToolkit(toolkit, {
          replacePrefix: "amos-workflow:",
        });
        if (activation.ok === false) {
          context.registry.unregisterWhere((tool) => tool.toolkit === toolkit);
          return activation;
        }
        return {
          ok: true,
          workflow_key: args.workflow_key,
          registered_tools: registered,
          next_step:
            "Use the relevant registered tool. Existing Mission budgets, scope, policy and approval gates remain in force.",
        };
      },
    },
  ];
}

// The business workflow runtime deliberately has no shell, coding delegation or
// arbitrary credentialled browser. Personal/local work retains its own runtime.
const SUPPORT_TOOLS = new Set([
  "list_files",
  "read_file",
  "desktop_read_attachment",
  "desktop_calculate",
  "desktop_create_document",
  "desktop_create_spreadsheet",
  "desktop_create_presentation",
  "desktop_present_canvas",
  "desktop_update_canvas",
  "desktop_present_company_view",
  "desktop_request_decision",
  "desktop_propose_consultative_update",
  "web_fetch",
  "web_search",
]);
export function workflowSupportTool(tool) {
  return SUPPORT_TOOLS.has(tool.name);
}
