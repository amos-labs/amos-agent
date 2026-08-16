export function createSubagentTools({
  spawn,
  list,
  collect,
  handoff,
  reportStage
} = {}) {
  return [
    {
      name: "desktop_handoff_role",
      source: "local",
      description:
        "Switch this task to the planner, implementer, or checker model without clearing the conversation. Use after a plan is ready, an implementation is verified, or a review needs a repair.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            enum: ["planner", "implementer", "checker"],
            description: "Next intelligence role for this same task."
          },
          summary: {
            type: "string",
            description: "One-paragraph handoff the next model should treat as the current brief."
          }
        },
        required: ["role"],
        additionalProperties: false
      },
      async handler(args) {
        if (typeof handoff !== "function") {
          throw new Error("Role handoff is unavailable in this session");
        }
        return handoff({
          role: args.role,
          summary: args.summary
        });
      }
    },
    {
      name: "desktop_report_coding_stage",
      source: "local",
      description:
        "Report the structured result of the current controller-owned coding stage. The controller, not model prose, decides the next planner, implementer, checker, repair, or terminal state.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: [
              "plan_ready",
              "implementation_ready",
              "approved",
              "repair_required",
              "no_code_change"
            ],
            description: "Structured outcome allowed for the current coding role."
          },
          summary: {
            type: "string",
            description: "Concrete plan, implementation result, approval, or repair brief."
          },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "Tests, diff observations, or other bounded evidence supporting this outcome."
          }
        },
        required: ["outcome", "summary"],
        additionalProperties: false
      },
      async handler(args) {
        if (typeof reportStage !== "function") {
          throw new Error("The deterministic coding lifecycle is unavailable in this session");
        }
        return reportStage({
          outcome: args.outcome,
          summary: args.summary,
          evidence: args.evidence
        });
      }
    },
    {
      name: "desktop_spawn_subagent",
      source: "local",
      description:
        "Start a bounded child task, usually on a new Git worktree, to do isolated implementation work. The child cannot spawn further children and cannot widen company authority.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short child task name." },
          objective: { type: "string", description: "Exact work the child should complete." },
          workspace_mode: {
            type: "string",
            enum: ["new_worktree", "same_directory"],
            description: "Default new_worktree so the child cannot dirty the parent tree."
          },
          role: {
            type: "string",
            enum: ["planner", "implementer", "checker"],
            description: "Defaults to implementer."
          }
        },
        required: ["objective"],
        additionalProperties: false
      },
      async handler(args) {
        if (typeof spawn !== "function") {
          throw new Error("Subagent fan-out is unavailable in this session");
        }
        return spawn({
          name: args.name,
          objective: args.objective,
          workspaceMode: args.workspace_mode || "new_worktree",
          role: args.role || "implementer"
        });
      }
    },
    {
      name: "desktop_list_subagents",
      source: "local",
      description: "List child tasks spawned from the current parent, with status and usage.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async handler() {
        if (typeof list !== "function") {
          throw new Error("Subagent listing is unavailable in this session");
        }
        return list();
      }
    },
    {
      name: "desktop_collect_subagent",
      source: "local",
      description:
        "Collect a child's bounded outcome: status, summary, usage, and workspace diff. This is evidence, not authority to replay the child.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Child task id returned by desktop_spawn_subagent." }
        },
        required: ["task_id"],
        additionalProperties: false
      },
      async handler(args) {
        if (typeof collect !== "function") {
          throw new Error("Subagent collection is unavailable in this session");
        }
        return collect({ taskId: args.task_id });
      }
    }
  ];
}
