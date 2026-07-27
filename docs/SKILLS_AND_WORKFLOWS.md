# Skills and workflows

AMOS separates three ideas that are easy to blur together:

- An **engine** is a governed capability surface: the tools, schemas, scopes,
  tenant boundary, and policy used to touch a real system.
- A **skill** is reusable operating judgment: how to investigate an issue,
  synthesize documents, implement a code change, ground a company decision, or
  verify an outcome well.
- A **workflow** is the visible route AMOS assembles for this task from one or
  more skills. It states the execution steps and the evidence required before
  the task is considered done.

For example, a request containing a GitHub issue URL selects **Diagnose the
GitHub issue**. That workflow combines evidence collection, version and
configuration comparison, code investigation, and verification. It tells the
model to inspect the report, compare the deployed or pinned version with current
source, verify the finding, and stop once the root cause and next action are
supported.

## Runtime behavior

Before the first model call, AMOS Desktop deterministically selects a built-in
workflow from the user's task and attachment context. The chosen workflow:

1. appears in **Live Work** before tool execution;
2. is injected as bounded, lower-priority guidance;
3. is recorded in task activity and the local receipt;
4. is included in an encrypted restart checkpoint as the selected planning
   step; and
5. remains steerable by the user while the task is running.

A workflow never bypasses the system prompt, tenant boundary, tool policy,
approval, or receipt path. It is guidance, not new authority. The model may
adapt the route when evidence requires it, but it should say why.

## Built-in first, portable next

The first release ships a reviewed built-in catalog for common work:

- GitHub issue and pull-request diagnosis;
- code changes;
- document analysis;
- current research;
- company decisions;
- governed company actions; and
- general evidence-backed execution.

The catalog is intentionally represented as versioned data rather than
hard-coded model prose. That is the contract for future signed packages and
tenant-scoped skills.

Tenant-created skills must not be treated as trusted executable code. A future
company skill package should carry an ID, version, owner, allowed tenants or
groups, required engines, instructions, verification criteria, provenance, and
signature. It may narrow a workflow or add domain judgment, but it may never
broaden scopes, embed secrets, pre-authorize a consequential action, or override
company policy.
