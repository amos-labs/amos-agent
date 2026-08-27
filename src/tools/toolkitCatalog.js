const DEFINITIONS = Object.freeze({
  core: Object.freeze({
    title: "AMOS core",
    description: "Essential AMOS orientation and progressive tool activation.",
    selectable: false
  }),
  workspace: Object.freeze({
    title: "Workspace and coding",
    description: "Inspect, search, edit, test, diff, and preview files or applications in the selected workspace."
  }),
  documents: Object.freeze({
    title: "Documents",
    description: "Create, edit, review, and finalize native document artifacts."
  }),
  calculations: Object.freeze({
    title: "Deterministic calculation",
    description: "Perform consequential arithmetic and explicit period conversions with typed deterministic steps."
  }),
  spreadsheets: Object.freeze({
    title: "Spreadsheets",
    description: "Create verified native XLSX workbooks, financial models, forecasts, budgets, and scenarios."
  }),
  presentations: Object.freeze({
    title: "Presentations",
    description: "Create verified native PowerPoint decks from a typed slide specification."
  }),
  research: Object.freeze({
    title: "Web research",
    description: "Fetch or search public web sources without operating an interactive browser."
  }),
  browser: Object.freeze({
    title: "Interactive browser",
    description: "Open, inspect, and interact with websites through semantic browser controls."
  }),
  "browser-recipes": Object.freeze({
    title: "Browser recipes",
    description: "Save, run, list, and remove deterministic browser workflows."
  }),
  "browser-visual": Object.freeze({
    title: "Visual browser fallback",
    description: "Use screenshots and bounded visual actions when semantic browser controls are insufficient."
  }),
  automation: Object.freeze({
    title: "Automation design",
    description: "Open the governed automation setup surface after the workflow is understood."
  }),
  collaboration: Object.freeze({
    title: "Parallel collaboration",
    description: "Delegate, inspect, and collect bounded subagent work or hand off an intelligence role."
  }),
  presentation: Object.freeze({
    title: "Dynamic canvas",
    description: "Present and update structured company, document, spreadsheet, browser, or code work surfaces.",
    selectable: false
  }),
  "company-continuity": Object.freeze({
    title: "Company continuity",
    description: "Read signed offline company context or stage a proposal for later reauthorization."
  })
});

const CORE_NAMES = new Set([
  "desktop_activate_toolkit",
  "desktop_request_work_surface",
  "desktop_request_decision",
  "desktop_inspect_conversation",
  "desktop_read_scratchpad",
  "desktop_update_scratchpad",
  "amos_get_started",
  "amos_whoami",
  "amos_resume_company",
  "amos_company_overview",
  "amos_list_engines",
  "amos_load_engine_tools",
  "amos_call_engine_tool"
]);

const EXACT_TOOLKITS = new Map([
  ["run_bash", "workspace"],
  ["desktop_focus_workspace", "workspace"],
  ["desktop_inspect_project", "workspace"],
  ["search_files", "workspace"],
  ["git_status", "workspace"],
  ["git_diff", "workspace"],
  ["apply_patch", "workspace"],
  ["list_files", "workspace"],
  ["read_file", "workspace"],
  ["write_file", "workspace"],
  ["desktop_present_code_workspace", "workspace"],
  ["desktop_preview_app", "workspace"],
  ["desktop_create_document", "documents"],
  ["desktop_edit_document", "documents"],
  ["desktop_finalize_document", "documents"],
  ["desktop_read_attachment", "documents"],
  ["desktop_calculate", "calculations"],
  ["desktop_create_spreadsheet", "spreadsheets"],
  ["desktop_create_presentation", "presentations"],
  ["web_fetch", "research"],
  ["web_search", "research"],
  ["desktop_begin_automation_setup", "automation"],
  ["desktop_handoff_role", "collaboration"],
  ["desktop_report_coding_stage", "collaboration"],
  ["desktop_spawn_subagent", "collaboration"],
  ["desktop_list_subagents", "collaboration"],
  ["desktop_collect_subagent", "collaboration"],
  ["desktop_present_canvas", "presentation"],
  ["desktop_present_company_view", "presentation"],
  ["desktop_update_canvas", "presentation"],
  ["desktop_propose_consultative_update", "presentation"],
  ["desktop_read_company_cache", "company-continuity"],
  ["desktop_stage_offline_proposal", "company-continuity"]
]);

export function toolkitDefinition(name) {
  return DEFINITIONS[name] || null;
}

export function toolkitCatalog() {
  return Object.entries(DEFINITIONS).map(([id, definition]) => ({ id, ...definition }));
}

export function inferToolToolkit(tool = {}) {
  const name = String(tool.name || "");
  if (CORE_NAMES.has(name)) return "core";
  if (name.startsWith("browser_recipe_")) return "browser-recipes";
  if (name.startsWith("browser_visual_")) return "browser-visual";
  if (name.startsWith("browser_")) return "browser";
  return EXACT_TOOLKITS.get(name) || null;
}
