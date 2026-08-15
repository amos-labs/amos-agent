const SCHEMA_VERSION = 1;
const MAX_CONSULTATIVE_CHARS = 32 * 1024;
const MAX_ASSERTIONS = 64;
const MAX_SOURCE_REFS = 4;
const MAX_CORRECTIONS = 4;
const MAX_LINKED_IDS = 8;

const LANE_STATUSES = ["active", "paused", "operating", "completed", "abandoned"];
const ASSERTION_STATUSES = [
  "confirmed",
  "observed",
  "inferred",
  "conflicting",
  "unknown",
  "superseded"
];
const KINDS = [
  "objective",
  "person",
  "system",
  "step",
  "handoff",
  "exception",
  "control",
  "assumption",
  "measure",
  "move",
  "outcome",
  "unknown",
  "evidence"
];
const SOURCES = ["user", "evidence", "inference", "application"];

const COLLECTION_CAPS = {
  successMeasures: { defaultKind: "measure", max: 8 },
  evidence: { defaultKind: "evidence", max: 16 },
  assumptions: { defaultKind: "assumption", max: 16 },
  materialUnknowns: { defaultKind: "unknown", max: 16 },
  candidateMoves: { defaultKind: "move", max: 8 },
  outcomes: { defaultKind: "outcome", max: 8 }
};

const CURRENT_STATE_CAPS = {
  people: { defaultKind: "person", max: 8 },
  systems: { defaultKind: "system", max: 16 },
  workflowSteps: { defaultKind: "step", max: 16 },
  handoffs: { defaultKind: "handoff", max: 8 },
  exceptions: { defaultKind: "exception", max: 8 },
  controls: { defaultKind: "control", max: 8 }
};

export function normalizeConsultativeState(
  value,
  { allowConfirmed = false, now = () => new Date() } = {}
) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Consultative state must be an object or null");
  }
  const schemaVersion = Number(value.schemaVersion ?? value.schema_version ?? SCHEMA_VERSION);
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Consultative state uses an unsupported schema version");
  }
  const status = value.status || "active";
  if (!LANE_STATUSES.includes(status)) {
    throw new Error("Consultative state has an invalid status");
  }
  const observedAt = isoNow(now);
  let count = 0;
  const currentState = value.currentState || value.current_state || {};
  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    status,
    objective: normalizeOptionalAssertion(
      value.objective,
      "objective",
      allowConfirmed,
      observedAt,
      () => { count += 1; }
    ),
    successMeasures: normalizeAssertionList(
      firstDefined(value.successMeasures, value.success_measures),
      COLLECTION_CAPS.successMeasures,
      "successMeasures",
      allowConfirmed,
      observedAt,
      (n) => { count += n; }
    ),
    currentState: Object.fromEntries(
      Object.entries(CURRENT_STATE_CAPS).map(([key, spec]) => [
        key,
        normalizeAssertionList(
          firstDefined(currentState[key], currentState[snakeKey(key)]),
          spec,
          `currentState.${key}`,
          allowConfirmed,
          observedAt,
          (n) => { count += n; }
        )
      ])
    ),
    evidence: normalizeAssertionList(
      value.evidence,
      COLLECTION_CAPS.evidence,
      "evidence",
      allowConfirmed,
      observedAt,
      (n) => { count += n; }
    ),
    assumptions: normalizeAssertionList(
      value.assumptions,
      COLLECTION_CAPS.assumptions,
      "assumptions",
      allowConfirmed,
      observedAt,
      (n) => { count += n; }
    ),
    materialUnknowns: normalizeAssertionList(
      firstDefined(value.materialUnknowns, value.material_unknowns),
      COLLECTION_CAPS.materialUnknowns,
      "materialUnknowns",
      allowConfirmed,
      observedAt,
      (n) => { count += n; }
    ),
    candidateMoves: normalizeAssertionList(
      firstDefined(value.candidateMoves, value.candidate_moves),
      COLLECTION_CAPS.candidateMoves,
      "candidateMoves",
      allowConfirmed,
      observedAt,
      (n) => { count += n; }
    ),
    recommendation: normalizeOptionalAssertion(
      value.recommendation,
      "move",
      allowConfirmed,
      observedAt,
      () => { count += 1; }
    ),
    intervention: normalizeOptionalAssertion(
      value.intervention,
      "move",
      allowConfirmed,
      observedAt,
      () => { count += 1; }
    ),
    outcomes: normalizeAssertionList(
      value.outcomes,
      COLLECTION_CAPS.outcomes,
      "outcomes",
      allowConfirmed,
      observedAt,
      (n) => { count += n; }
    ),
    linkedResources: normalizeLinkedResources(
      firstDefined(value.linkedResources, value.linked_resources)
    ),
    updatedAt: cleanTimestamp(firstDefined(value.updatedAt, value.updated_at), observedAt)
  };
  if (count > MAX_ASSERTIONS) {
    throw new Error(`Consultative state exceeds ${MAX_ASSERTIONS} assertions`);
  }
  const encoded = JSON.stringify(normalized);
  if (encoded.length > MAX_CONSULTATIVE_CHARS) {
    throw new Error("Consultative state exceeds the bounded continuity envelope");
  }
  return normalized;
}

export function resolveConsultativeUpdate(value, options = {}) {
  if (value === undefined) return { kind: "omit" };
  if (value === null) return { kind: "clear" };
  return { kind: "set", state: normalizeConsultativeState(value, options) };
}

export function applyConsultativeUpdate(previous, update) {
  if (!update || update.kind === "omit") return previous || null;
  if (update.kind === "clear") return null;
  return update.state || null;
}

export function forkConsultativeState(
  state,
  { contextScope = "from_here", sourceEventId = "", selectedArtifacts = [], keptEventIds = [] } = {}
) {
  if (!state) return null;
  if (contextScope === "everything") return normalizeConsultativeState(state, { allowConfirmed: true });
  if (contextScope === "selected_artifacts") {
    return selectedArtifacts.some(isOperatingPlanArtifact)
      ? normalizeConsultativeState(state, { allowConfirmed: true })
      : null;
  }
  const allowed = new Set(
    (Array.isArray(keptEventIds) ? keptEventIds : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  );
  if (sourceEventId) allowed.add(String(sourceEventId).trim());
  return filterConsultativeState(state, (assertion) => {
    const eventId = String(assertion?.sourceEventId || "").trim();
    return eventId && allowed.has(eventId);
  });
}

export const OPERATING_PLAN_BLOCK_ID = "operating-plan";
export const OPERATING_PLAN_CANVAS_TITLE = "Operating plan";

export function confirmConsultativeAssertion(state, assertionId, { now = () => new Date() } = {}) {
  const current = normalizeConsultativeState(state, { allowConfirmed: true, now });
  if (!current) throw new Error("There is no consultative state to confirm");
  const found = mutateAssertion(current, assertionId, (assertion) => ({
    ...assertion,
    status: "confirmed",
    source: "application",
    confirmedAt: isoNow(now)
  }));
  if (!found) throw new Error("That consultative assertion is no longer in this task");
  current.updatedAt = isoNow(now);
  return current;
}

export function correctConsultativeAssertion(
  state,
  assertionId,
  statement,
  { now = () => new Date(), sourceEventId = "" } = {}
) {
  const current = normalizeConsultativeState(state, { allowConfirmed: true, now });
  if (!current) throw new Error("There is no consultative state to correct");
  const nextStatement = redact(cleanText(statement, 600));
  if (!nextStatement) throw new Error("A correction needs a replacement statement");
  const found = mutateAssertion(current, assertionId, (assertion) => ({
    ...assertion,
    statement: nextStatement,
    status: "confirmed",
    source: "application",
    confirmedAt: isoNow(now),
    corrections: [
      ...(assertion.corrections || []),
      {
        at: isoNow(now),
        previousStatement: assertion.statement,
        previousStatus: assertion.status,
        sourceEventId: cleanText(sourceEventId, 160)
      }
    ].slice(-MAX_CORRECTIONS)
  }));
  if (!found) throw new Error("That consultative assertion is no longer in this task");
  current.updatedAt = isoNow(now);
  return current;
}

export function rejectConsultativeAssertion(state, assertionId, { now = () => new Date() } = {}) {
  const current = normalizeConsultativeState(state, { allowConfirmed: true, now });
  if (!current) throw new Error("There is no consultative state to reject");
  const found = mutateAssertion(current, assertionId, (assertion) => ({
    ...assertion,
    status: "superseded",
    source: "application",
    confirmedAt: ""
  }));
  if (!found) throw new Error("That consultative assertion is no longer in this task");
  current.updatedAt = isoNow(now);
  return current;
}

export function reopenConsultativeAssertion(state, assertionId, { now = () => new Date() } = {}) {
  const current = normalizeConsultativeState(state, { allowConfirmed: true, now });
  if (!current) throw new Error("There is no consultative state to reopen");
  const found = mutateAssertion(current, assertionId, (assertion) => ({
    ...assertion,
    status: assertion.confidence == null ? "unknown" : "inferred",
    source: "user",
    confirmedAt: ""
  }));
  if (!found) throw new Error("That consultative assertion is no longer in this task");
  current.updatedAt = isoNow(now);
  return current;
}

export function consultativeStateHasOperatingPlan(state) {
  if (!state?.objective?.statement) return false;
  if (state.recommendation || state.intervention) return true;
  const lists = [
    state.successMeasures,
    state.evidence,
    state.assumptions,
    state.materialUnknowns,
    state.candidateMoves,
    state.outcomes,
    ...Object.values(state.currentState || {})
  ];
  return lists.some((items) => Array.isArray(items) && items.length > 0);
}

export function compileOperatingPlanBlock(state, { now = () => new Date() } = {}) {
  const current = state
    ? normalizeConsultativeState(state, { allowConfirmed: true, now })
    : null;
  if (!consultativeStateHasOperatingPlan(current)) return null;
  const sections = [
    section("outcome", "Desired outcome", [
      current.objective,
      ...(current.successMeasures || [])
    ]),
    section("understanding", "Current understanding", [
      ...(current.currentState?.people || []),
      ...(current.currentState?.systems || []),
      ...(current.currentState?.workflowSteps || []),
      ...(current.currentState?.handoffs || []),
      ...(current.currentState?.exceptions || []),
      ...(current.currentState?.controls || [])
    ]),
    section("evidence", "Evidence and uncertainty", [
      ...(current.evidence || []),
      ...(current.assumptions || []),
      ...(current.materialUnknowns || [])
    ]),
    section(
      "opportunities",
      "Opportunities",
      [...(current.candidateMoves || [])].sort((left, right) => (
        Number(right.confidence ?? 0) - Number(left.confidence ?? 0)
      ))
    ),
    section("recommendation", "Recommendation", [current.recommendation]),
    section("intervention", "Chosen intervention", [current.intervention]),
    section("outcomes", "Observed outcomes", current.outcomes)
  ].filter(Boolean);
  const items = sections.flatMap((entry) => entry.items);
  return {
    id: OPERATING_PLAN_BLOCK_ID,
    type: "operating_plan",
    title: OPERATING_PLAN_CANVAS_TITLE,
    status: current.status,
    sections,
    provenance: {
      sourceKind: "local",
      sourceLabel: "Task consultative state",
      observedAt: current.updatedAt || isoNow(now),
      uncertainty: planUncertainty(items)
    }
  };
}

export function compileOperatingPlanCanvas(state, { now = () => new Date() } = {}) {
  const block = compileOperatingPlanBlock(state, { now });
  if (!block) return null;
  const observedAt = block.provenance.observedAt;
  return {
    version: "1",
    title: OPERATING_PLAN_CANVAS_TITLE,
    subtitle: state.objective?.statement || "A living projection of this task's consultative state.",
    generated_at: observedAt,
    state: { kind: "ready" },
    source: {
      kind: "local",
      label: "Task consultative state",
      refreshed_at: observedAt,
      references: []
    },
    blocks: [block]
  };
}

function section(id, title, values) {
  const items = (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .map(planItem);
  if (items.length === 0) return null;
  return { id, title, items };
}

function planItem(assertion) {
  return {
    id: assertion.id,
    kind: assertion.kind,
    statement: assertion.statement,
    status: assertion.status,
    source: assertion.source,
    confidence: assertion.confidence,
    sourceEventId: assertion.sourceEventId,
    observedAt: assertion.observedAt,
    actions: planActions(assertion.status)
  };
}

function planActions(status) {
  if (status === "superseded") return ["reopen"];
  if (status === "confirmed") return ["correct", "reopen"];
  return ["confirm", "correct", "reject"];
}

function planUncertainty(items) {
  const ranks = {
    conflicting: 5,
    unknown: 4,
    inferred: 3,
    observed: 2,
    confirmed: 1,
    superseded: 1
  };
  let best = "none";
  let score = 0;
  for (const item of items) {
    const next = ranks[item.status] || 0;
    if (next > score) {
      score = next;
      best = item.status === "confirmed" || item.status === "superseded" ? "none" : item.status;
    }
  }
  return best;
}

export function proposeConsultativeState(
  previous,
  proposal = {},
  { sourceEventId, now = () => new Date() } = {}
) {
  const eventId = cleanText(sourceEventId, 160);
  if (!eventId) throw new Error("A consultative proposal needs a source event id");
  const observedAt = isoNow(now);
  const current = previous
    ? normalizeConsultativeState(previous, { allowConfirmed: true, now })
    : normalizeConsultativeState({ status: proposal.status || "active" }, { allowConfirmed: true, now });
  const stamp = (item, defaultKind) => {
    if (!item || typeof item !== "object") return null;
    const statement = redact(cleanText(item.statement, 600));
    if (!statement) return null;
    return {
      id: cleanText(item.id, 64) || newAssertionId(),
      kind: item.kind || defaultKind,
      statement,
      status: "inferred",
      source: "inference",
      sourceEventId: eventId,
      observedAt,
      confidence: item.confidence == null ? 0.6 : Number(item.confidence),
      visibility: "task_private"
    };
  };
  if (proposal.objective) {
    current.objective = stamp(proposal.objective, "objective");
  }
  if (proposal.recommendation) {
    current.recommendation = stamp(proposal.recommendation, "move");
  }
  if (proposal.intervention) {
    current.intervention = stamp(proposal.intervention, "move");
  }
  for (const item of Array.isArray(proposal.assertions) ? proposal.assertions : []) {
    const kind = item?.kind || "assumption";
    const stamped = stamp(item, kind);
    if (!stamped) continue;
    placeAssertion(current, stamped);
  }
  if (proposal.status && LANE_STATUSES.includes(proposal.status)) {
    current.status = proposal.status;
  }
  current.updatedAt = observedAt;
  return normalizeConsultativeState(current, { allowConfirmed: false, now });
}

function placeAssertion(state, assertion) {
  const collection = collectionForKind(assertion.kind);
  if (collection === "objective") {
    state.objective = assertion;
    return;
  }
  if (collection === "recommendation") {
    state.recommendation = assertion;
    return;
  }
  if (collection === "intervention") {
    state.intervention = assertion;
    return;
  }
  if (CURRENT_STATE_CAPS[collection]) {
    state.currentState[collection] = upsertAssertion(state.currentState[collection], assertion);
    return;
  }
  if (COLLECTION_CAPS[collection]) {
    state[collection] = upsertAssertion(state[collection], assertion);
  }
}

function collectionForKind(kind) {
  switch (kind) {
    case "objective": return "objective";
    case "person": return "people";
    case "system": return "systems";
    case "step": return "workflowSteps";
    case "handoff": return "handoffs";
    case "exception": return "exceptions";
    case "control": return "controls";
    case "measure": return "successMeasures";
    case "evidence": return "evidence";
    case "assumption": return "assumptions";
    case "unknown": return "materialUnknowns";
    case "move": return "candidateMoves";
    case "outcome": return "outcomes";
    default: return "assumptions";
  }
}

function upsertAssertion(list, assertion) {
  const items = Array.isArray(list) ? [...list] : [];
  const index = items.findIndex((item) => item.id === assertion.id);
  if (index >= 0) items[index] = assertion;
  else items.push(assertion);
  return items;
}

function newAssertionId() {
  return `c:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function compileConsultativeContext(state, { maxChars = 1_800 } = {}) {
  if (!state) return "";
  const lines = [
    "consultative_state {",
    `status ${safeJson(state.status)}`,
    state.objective
      ? `objective ${safeJson(compactAssertion(state.objective, true))}`
      : "",
    state.recommendation
      ? `recommendation ${safeJson(compactAssertion(state.recommendation, true))}`
      : ""
  ].filter(Boolean);
  const extras = [
    ...collectAssertions(state)
      .filter((item) => item !== state.objective && item !== state.recommendation)
      .slice(0, 8)
      .map((item) => `assertion ${safeJson(compactAssertion(item, false))}`)
  ];
  for (const line of extras) {
    if ([...lines, line, "}"].join("\n").length > maxChars) break;
    lines.push(line);
  }
  lines.push("}");
  const compiled = lines.join("\n");
  return compiled.length > maxChars ? compiled.slice(0, maxChars) : compiled;
}

export function isOperatingPlanArtifact(value) {
  return /operating[-_ ]?plan/i.test(String(value || ""));
}

function filterConsultativeState(state, predicate) {
  const mapList = (items) => (Array.isArray(items) ? items : []).filter(predicate);
  const filtered = {
    ...state,
    objective: state.objective && predicate(state.objective) ? state.objective : null,
    successMeasures: mapList(state.successMeasures),
    currentState: Object.fromEntries(
      Object.keys(CURRENT_STATE_CAPS).map((key) => [
        key,
        mapList(state.currentState?.[key])
      ])
    ),
    evidence: mapList(state.evidence),
    assumptions: mapList(state.assumptions),
    materialUnknowns: mapList(state.materialUnknowns),
    candidateMoves: mapList(state.candidateMoves),
    recommendation: state.recommendation && predicate(state.recommendation)
      ? state.recommendation
      : null,
    intervention: state.intervention && predicate(state.intervention)
      ? state.intervention
      : null,
    outcomes: mapList(state.outcomes)
  };
  return collectAssertions(filtered).length > 0
    ? normalizeConsultativeState(filtered, { allowConfirmed: true })
    : {
        ...normalizeConsultativeState({ status: state.status || "active" }, { allowConfirmed: true }),
        status: state.status || "active"
      };
}

function mutateAssertion(state, assertionId, mutate) {
  const target = String(assertionId || "").trim();
  if (!target) return false;
  let found = false;
  const visit = (item) => {
    if (!item || item.id !== target) return item;
    found = true;
    return mutate(item);
  };
  if (state.objective) state.objective = visit(state.objective);
  if (state.recommendation) state.recommendation = visit(state.recommendation);
  if (state.intervention) state.intervention = visit(state.intervention);
  for (const key of Object.keys(COLLECTION_CAPS)) {
    state[key] = (state[key] || []).map(visit);
  }
  for (const key of Object.keys(CURRENT_STATE_CAPS)) {
    state.currentState[key] = (state.currentState[key] || []).map(visit);
  }
  return found;
}

function collectAssertions(state) {
  if (!state) return [];
  return [
    state.objective,
    ...(state.successMeasures || []),
    ...Object.values(state.currentState || {}).flat(),
    ...(state.evidence || []),
    ...(state.assumptions || []),
    ...(state.materialUnknowns || []),
    ...(state.candidateMoves || []),
    state.recommendation,
    state.intervention,
    ...(state.outcomes || [])
  ].filter(Boolean);
}

function normalizeOptionalAssertion(value, defaultKind, allowConfirmed, now, mark) {
  if (value == null) return null;
  mark();
  return normalizeAssertion(value, defaultKind, allowConfirmed, now);
}

function normalizeAssertionList(value, spec, label, allowConfirmed, now, mark) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > spec.max) throw new Error(`${label} exceeds ${spec.max} items`);
  mark(value.length);
  return value.map((item) => normalizeAssertion(item, spec.defaultKind, allowConfirmed, now));
}

function normalizeAssertion(value, defaultKind, allowConfirmed, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Each consultative assertion must be an object");
  }
  const statement = redact(cleanText(value.statement, 600));
  if (!statement) throw new Error("Each consultative assertion needs a statement");
  const id = cleanIdentifier(value.id, 64, "assertion id");
  const kind = value.kind || defaultKind;
  if (!KINDS.includes(kind)) throw new Error("Consultative assertion has an invalid kind");
  let status = value.status || "inferred";
  if (!ASSERTION_STATUSES.includes(status)) {
    throw new Error("Consultative assertion has an invalid status");
  }
  let source = value.source
    || (status === "inferred" ? "inference" : status === "observed" ? "evidence" : "user");
  if (!SOURCES.includes(source)) {
    throw new Error("Consultative assertion has an invalid source");
  }
  let confirmedAt = cleanOptionalTimestamp(firstDefined(value.confirmedAt, value.confirmed_at));
  let downgraded = false;
  if (status === "confirmed" && !allowConfirmed) {
    status = "inferred";
    source = "inference";
    confirmedAt = "";
    downgraded = true;
  }
  if (status === "confirmed" && !confirmedAt) confirmedAt = now;
  if (status !== "confirmed") confirmedAt = "";
  let confidence = value.confidence == null ? null : Number(value.confidence);
  if (confidence != null && !(confidence >= 0 && confidence <= 1)) {
    throw new Error("Consultative assertion confidence must be between 0 and 1");
  }
  if (status === "inferred" && confidence == null) {
    if (!downgraded) throw new Error("Inferred consultative assertions need a confidence");
    confidence = 0.5;
  }
  const sourceEventId = cleanText(firstDefined(value.sourceEventId, value.source_event_id), 160);
  if (!sourceEventId) throw new Error("Each consultative assertion needs a sourceEventId");
  const observedAt = cleanOptionalTimestamp(firstDefined(value.observedAt, value.observed_at)) || now;
  if (!observedAt) throw new Error("Each consultative assertion needs observedAt");
  const visibility = value.visibility || "task_private";
  if (visibility !== "task_private") {
    throw new Error("Consultative assertion visibility must be task_private");
  }
  return {
    id,
    kind,
    statement,
    status,
    source,
    sourceRefs: uniqueStrings(firstDefined(value.sourceRefs, value.source_refs), MAX_SOURCE_REFS, 256),
    sourceEventId,
    observedAt,
    confidence,
    visibility,
    confirmedAt,
    supersedesId: cleanText(firstDefined(value.supersedesId, value.supersedes_id), 64),
    corrections: normalizeCorrections(value.corrections)
  };
}

function normalizeCorrections(value) {
  return (Array.isArray(value) ? value : []).slice(-MAX_CORRECTIONS).flatMap((item) => {
    const previousStatement = redact(cleanText(
      firstDefined(item?.previousStatement, item?.previous_statement),
      600
    ));
    if (!previousStatement) return [];
    return [{
      at: cleanOptionalTimestamp(item?.at),
      previousStatement,
      previousStatus: cleanText(firstDefined(item?.previousStatus, item?.previous_status), 80),
      sourceEventId: cleanText(firstDefined(item?.sourceEventId, item?.source_event_id), 160)
    }];
  });
}

function normalizeLinkedResources(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    automationIds: uniqueStrings(firstDefined(source.automationIds, source.automation_ids), MAX_LINKED_IDS, 128),
    goalIds: uniqueStrings(firstDefined(source.goalIds, source.goal_ids), MAX_LINKED_IDS, 128),
    briefingIds: uniqueStrings(firstDefined(source.briefingIds, source.briefing_ids), MAX_LINKED_IDS, 128),
    artifactIds: uniqueStrings(firstDefined(source.artifactIds, source.artifact_ids), MAX_LINKED_IDS, 128),
    decisionIds: uniqueStrings(firstDefined(source.decisionIds, source.decision_ids), MAX_LINKED_IDS, 128),
    receiptIds: uniqueStrings(firstDefined(source.receiptIds, source.receipt_ids), MAX_LINKED_IDS, 128)
  };
}

function compactAssertion(item, latest) {
  return Object.fromEntries(Object.entries({
    id: item?.id,
    kind: item?.kind,
    status: item?.status,
    source: item?.source,
    statement: compactText(item?.statement, latest ? 220 : 120),
    sourceEventId: item?.sourceEventId || undefined
  }).filter(([, value]) => value));
}

function uniqueStrings(value, maxItems, maxLength) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => redact(cleanText(item, maxLength)))
    .filter(Boolean))]
    .slice(-maxItems);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function snakeKey(value) {
  return String(value || "").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function cleanIdentifier(value, maxLength, label) {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned || !/^[A-Za-z0-9._:-]+$/.test(cleaned)) {
    throw new Error(`Consultative state is missing ${label}`);
  }
  return cleaned;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanTimestamp(value, fallback) {
  const date = new Date(value || fallback || "");
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Consultative state has an invalid timestamp");
  }
  return date.toISOString();
}

function cleanOptionalTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Consultative state has an invalid timestamp");
  }
  return date.toISOString();
}

function isoNow(now) {
  return typeof now === "function" ? now().toISOString() : new Date(now).toISOString();
}

function redact(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g, "[REDACTED TOKEN]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]")
    .replace(/((?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}
