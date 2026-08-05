export const COMPANY_VIEW_INTENTS = Object.freeze([
  "auto",
  "company_overview",
  "performance",
  "learning",
  "kpi",
  "funnel",
  "cohort",
  "timeline",
  "comparison",
  "approvals",
  "receipts",
  "live_work"
]);

const MAX_METRICS = 8;
const MAX_ROWS = 200;
const MAX_COLUMNS = 12;
const MAX_DECISIONS = 12;
const MAX_REFERENCES = 100;

export function adaptCompanyResult({
  intent = "auto",
  title = "",
  sourceTool,
  result,
  observedAt = new Date().toISOString()
}) {
  if (!COMPANY_VIEW_INTENTS.includes(intent)) {
    throw new Error(`Unsupported company view intent: ${intent}`);
  }
  const payload = unwrapResult(result);
  const resolvedIntent = intent === "auto" ? inferIntent(sourceTool, payload) : intent;
  const sourceLabel = humanize(sourceTool || "AMOS company data");
  const references = collectReferences(payload).slice(0, MAX_REFERENCES);
  const state = resultState(payload);
  const context = {
    sourceTool,
    observedAt,
    tenantId: findDeepValue(payload, ["tenant_id", "tenantId"])
  };
  const blocks = state.kind === "ready" || state.kind === "partial"
    ? blocksForIntent(resolvedIntent, payload, context)
    : [];

  return {
    version: "1",
    title: cleanText(title, 160) || titleForIntent(resolvedIntent),
    subtitle: subtitleForIntent(resolvedIntent),
    generated_at: observedAt,
    state,
    source: {
      kind: "live",
      label: sourceLabel,
      refreshed_at: observedAt,
      refresh_prompt: `Refresh ${cleanText(title, 160) || titleForIntent(resolvedIntent)}`,
      references
    },
    blocks: blocks.length > 0
      ? blocks
      : state.kind === "ready"
        ? [{
            id: "result-brief",
            type: "markdown",
            title: "Result",
            content: textSummary(payload) || "AMOS returned a result without displayable fields.",
            provenance: provenance({ ...context, references, uncertainty: "partial" })
          }]
        : []
  };
}

export function adaptBriefingRun(payload, { observedAt = new Date().toISOString() } = {}) {
  const response = payload?.definition && payload?.run && payload?.result
    ? payload
    : unwrapResult(payload);
  const definition = response?.definition && typeof response.definition === "object"
    ? response.definition
    : {};
  const result = response?.result && typeof response.result === "object"
    ? response.result
    : {};
  const run = response?.run && typeof response.run === "object" ? response.run : {};
  const hint = result?.presentation_hint && typeof result.presentation_hint === "object"
    ? result.presentation_hint
    : {};
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const blocks = [];
  const references = [];
  for (const source of sources) {
    const tool = cleanText(source?.tool, 120);
    const sourceObservedAt = source?.observed_at || observedAt;
    references.push({
      type: "amos_tool",
      id: tool,
      label: humanize(tool || "AMOS source"),
      observed_at: sourceObservedAt
    });
    if (source?.status !== "available") continue;
    const intent = intentForBriefingSource(tool, hint.intent);
    const adapted = adaptCompanyResult({
      intent,
      title: definition.title || result.title || "Company Briefing",
      sourceTool: tool,
      result: source.data,
      observedAt: sourceObservedAt
    });
    for (const block of adapted.blocks || []) {
      blocks.push({ ...block, id: `${slug(tool || "source")}-${block.id}` });
      if (blocks.length >= 24) break;
    }
    if (blocks.length >= 24) break;
  }
  const stateKind = ["ready", "partial", "restricted"].includes(result.state)
    ? result.state
    : blocks.length > 0
      ? "ready"
      : "empty";
  return {
    version: "1",
    title: cleanText(definition.title || result.title || "Company Briefing", 160),
    subtitle: cleanText(
      definition.objective || result.objective || "A governed view refreshed from current company sources.",
      500
    ),
    generated_at: run.completed_at || observedAt,
    state: {
      kind: stateKind,
      message: stateKind === "restricted"
        ? "Current permissions or source availability did not permit this Briefing to load."
        : stateKind === "partial"
          ? "Some governed sources were unavailable; available evidence is shown."
          : undefined
    },
    source: {
      kind: "live",
      label: "AMOS governed Briefing",
      refreshed_at: run.completed_at || observedAt,
      refresh_prompt: definition.id
        ? `Run the saved Briefing ${definition.title || result.title || "again"}`
        : `Refresh ${definition.title || result.title || "this Briefing"}`,
      references,
      briefing: {
        definition_id: definition.id || run.briefing_id || "",
        run_id: run.id || "",
        template_key: definition.template_key || result.template_key || "",
        title: definition.title || result.title || "Company Briefing",
        objective: definition.objective || result.objective || "Refresh this governed company Briefing.",
        source_plan: definition.source_plan || [],
        parameters: definition.parameters || {},
        presentation: definition.presentation || hint || {}
      }
    },
    blocks: blocks.length > 0
      ? blocks
      : stateKind === "ready"
        ? [{
            id: "briefing-result",
            type: "markdown",
            title: "Briefing result",
            content: textSummary(result) || "AMOS completed the Briefing without displayable fields.",
            provenance: provenance({ sourceTool: "run_briefing", observedAt, references })
          }]
        : []
  };
}

function intentForBriefingSource(tool, requestedIntent) {
  if (tool === "get_performance_snapshot") return "performance";
  if (tool === "growth_summary" || tool === "ads_overview") return "funnel";
  if (tool === "list_pending_operations") return "approvals";
  if (tool === "list_receipts") return "receipts";
  return COMPANY_VIEW_INTENTS.includes(requestedIntent) ? requestedIntent : "auto";
}

function blocksForIntent(intent, payload, context) {
  if (intent === "approvals") return decisionBlocks(payload, "approval", context);
  if (intent === "receipts") return decisionBlocks(payload, "receipt", context);
  if (intent === "performance") return performanceBlocks(payload, context);
  if (intent === "learning") return learningBlocks(payload, context);
  if (intent === "timeline") return timelineBlocks(payload, context);
  if (intent === "funnel") return funnelBlocks(payload, context);
  if (intent === "cohort" || intent === "comparison") return comparisonBlocks(payload, context);
  if (intent === "live_work") {
    return [
      ...decisionBlocks(payload, "approval", context),
      ...genericDataBlocks(payload, context)
    ].slice(0, 24);
  }
  return genericDataBlocks(payload, context);
}

function learningBlocks(payload, context) {
  const course = payload?.item && typeof payload.item === "object"
    ? payload.item
    : payload?.course && typeof payload.course === "object"
      ? payload.course
      : payload;
  const references = collectReferences(payload);
  const baseProvenance = provenance({ ...context, references });
  const blocks = [];
  const description = firstValue(course, [
    "description",
    "short_description",
    "summary",
    "topic"
  ]);
  if (description) {
    blocks.push({
      id: "learning-overview",
      type: "markdown",
      title: cleanText(course.title || course.name || "Course overview", 160),
      content: cleanText(description, 20_000),
      provenance: baseProvenance
    });
  }

  const status = firstValue(course, ["status", "state"]);
  if (status || typeof course?.published === "boolean") {
    blocks.push({
      id: "learning-status",
      type: "metric",
      label: "Course status",
      value: status ? humanize(status) : course.published ? "Published" : "Draft",
      trend: "neutral",
      provenance: baseProvenance
    });
  }
  const length = finiteNumber(firstValue(course, ["length", "hours", "duration"]));
  if (length !== null) {
    blocks.push({
      id: "learning-length",
      type: "metric",
      label: "Estimated length",
      value: length,
      unit: cleanText(course.length_unit || (course.hours ? "hours" : ""), 40),
      trend: "neutral",
      provenance: baseProvenance
    });
  }

  const modules = Array.isArray(course?.modules) ? course.modules.slice(0, MAX_ROWS) : [];
  if (modules.length > 0) {
    blocks.push({
      id: "learning-modules-count",
      type: "metric",
      label: "Modules",
      value: modules.length,
      trend: "neutral",
      provenance: baseProvenance
    });
    const rows = modules.map((module, index) => ({
      order: finiteNumber(firstValue(module, ["position", "order", "sequence"])) ?? index + 1,
      module: String(firstValue(module, ["title", "name", "label"]) || `Module ${index + 1}`),
      lessons: Array.isArray(module?.lessons)
        ? module.lessons.length
        : finiteNumber(firstValue(module, ["lesson_count", "lessons_count"])),
      status: stringValue(firstValue(module, ["status", "state"])) || null
    }));
    const moduleTable = tableBlock(rows, "Course modules", baseProvenance);
    if (moduleTable) blocks.push(moduleTable);
  }

  const reviewUrl = safeLearningUrl(firstValue(course, ["review_url", "reviewUrl"]));
  const courseUrl = safeLearningUrl(firstValue(course, ["url", "course_url", "courseUrl"]));
  const destination = reviewUrl || courseUrl;
  if (destination) {
    blocks.push({
      id: "learning-destination",
      type: "link",
      title: reviewUrl ? "Review the draft" : "Open the course",
      label: cleanText(course.title || course.name || "Learning course", 160),
      description: reviewUrl
        ? "Open the governed course review experience in your browser."
        : "Open the generated course in your browser.",
      url: destination,
      action_label: reviewUrl ? "Review draft" : "Open course",
      provenance: baseProvenance
    });
  }
  if (references.length > 0) {
    blocks.push({
      id: "learning-evidence",
      type: "sources",
      title: "Course source",
      items: references.slice(0, MAX_REFERENCES),
      provenance: baseProvenance
    });
  }
  return blocks.length > 0 ? blocks.slice(0, 24) : genericDataBlocks(payload, context);
}

function genericDataBlocks(payload, context) {
  const references = collectReferences(payload);
  const baseProvenance = provenance({ ...context, references });
  const blocks = [];
  for (const metric of collectMetrics(payload).slice(0, MAX_METRICS)) {
    blocks.push({
      id: `metric-${slug(metric.path)}`,
      type: "metric",
      label: humanize(metric.path),
      value: metric.value,
      trend: "neutral",
      provenance: baseProvenance
    });
  }

  const rows = bestRecordArray(payload);
  if (rows.length > 0) {
    const table = tableBlock(rows, "Current records", baseProvenance);
    if (table) blocks.push(table);
    const series = timeSeriesBlock(rows, baseProvenance);
    if (series) blocks.push(series);
  }

  const summary = textSummary(payload);
  if (summary && blocks.length === 0) {
    blocks.push({
      id: "operating-brief",
      type: "markdown",
      title: "Operating brief",
      content: summary,
      provenance: baseProvenance
    });
  }
  if (references.length > 0) {
    blocks.push({
      id: "evidence",
      type: "sources",
      title: "Sources and evidence",
      items: references.slice(0, MAX_REFERENCES),
      provenance: baseProvenance
    });
  }
  return blocks.slice(0, 24);
}

function funnelBlocks(payload, context) {
  const rows = bestRecordArray(payload);
  const references = collectReferences(payload);
  const baseProvenance = provenance({ ...context, references });
  if (rows.length === 0) return genericDataBlocks(payload, context);

  const stageKey = findKey(rows[0], ["stage", "step", "name", "label"]);
  const valueKey = findNumericKey(rows[0], ["count", "value", "total", "sessions", "users"]);
  if (!stageKey || !valueKey) return genericDataBlocks(payload, context);

  const blocks = rows.slice(0, MAX_METRICS).map((row, index) => ({
    id: `funnel-${index + 1}`,
    type: "metric",
    label: String(row[stageKey]),
    value: finiteNumber(row[valueKey]) ?? 0,
    change: index === 0 ? "" : conversionLabel(rows[index - 1]?.[valueKey], row[valueKey]),
    trend: "neutral",
    provenance: baseProvenance
  }));
  const table = tableBlock(rows, "Funnel stages", baseProvenance);
  if (table) blocks.push(table);
  return blocks;
}

function comparisonBlocks(payload, context) {
  const rows = bestRecordArray(payload);
  const references = collectReferences(payload);
  const baseProvenance = provenance({ ...context, references });
  const table = tableBlock(rows, "Comparison", baseProvenance);
  return table ? [table] : genericDataBlocks(payload, context);
}

function performanceBlocks(payload, context) {
  const units = Array.isArray(payload?.operating_units) ? payload.operating_units : [];
  const entries = [];
  for (const unit of units.slice(0, MAX_ROWS)) {
    const metrics = Array.isArray(unit?.metrics) ? unit.metrics : [];
    for (const item of metrics.slice(0, MAX_ROWS)) {
      const metric = item?.metric && typeof item.metric === "object" ? item.metric : {};
      const current = item?.current && typeof item.current === "object" ? item.current : null;
      if (!current || finiteNumber(current.value) === null) continue;
      const benchmarks = Array.isArray(item.benchmarks) ? item.benchmarks : [];
      const primaryBenchmark = benchmarks.find((benchmark) =>
        finiteNumber(benchmark?.value) !== null
      ) || null;
      const shortfall = finiteNumber(primaryBenchmark?.gap?.shortfall) ?? 0;
      const relativeShortfall = finiteNumber(primaryBenchmark?.gap?.relative_shortfall) ?? 0;
      entries.push({
        unit,
        item,
        metric,
        current,
        previous: item?.previous && typeof item.previous === "object" ? item.previous : null,
        trend: item?.trend && typeof item.trend === "object" ? item.trend : null,
        primaryBenchmark,
        attention: shortfall > 0,
        shortfall,
        relativeShortfall
      });
    }
  }
  if (entries.length === 0) return genericDataBlocks(payload, context);

  entries.sort((left, right) =>
    Number(right.attention) - Number(left.attention) ||
    right.relativeShortfall - left.relativeShortfall ||
    String(left.unit?.name || left.unit?.key || "").localeCompare(
      String(right.unit?.name || right.unit?.key || "")
    ) ||
    String(left.metric?.name || left.metric?.key || "").localeCompare(
      String(right.metric?.name || right.metric?.key || "")
    )
  );

  const blocks = entries.slice(0, MAX_METRICS).map((entry, index) => {
    const references = collectReferences({
      current: entry.current,
      benchmark: entry.primaryBenchmark
    });
    return {
      id: `performance-${index + 1}-${slug(entry.unit?.key)}-${slug(entry.metric?.key)}`,
      type: "metric",
      label: cleanText(
        `${entry.metric?.name || humanize(entry.metric?.key)} — ${entry.unit?.name || humanize(entry.unit?.key)}`,
        120
      ),
      value: formatPerformanceValue(entry.current.value, entry.metric),
      trend: performanceTone(entry),
      change: performanceChange(entry),
      note: cleanText([
        humanize(entry.current.data_classification || "unclassified"),
        entry.current.source_name || entry.current.source_kind,
        entry.current.period_end ? `period ending ${entry.current.period_end}` : "",
        "observed comparison; not a causal claim"
      ].filter(Boolean).join(" · "), 300),
      provenance: provenance({ ...context, references })
    };
  });

  blocks.push({
    id: "performance-comparison",
    type: "table",
    title: "Performance and benchmark gaps",
    searchable: true,
    columns: [
      { key: "unit", label: "Operating unit", format: "text" },
      { key: "type", label: "Type", format: "text" },
      { key: "metric", label: "Metric", format: "text" },
      { key: "current", label: "Current", format: "text" },
      { key: "previous", label: "Previous", format: "text" },
      { key: "trend", label: "Trend", format: "text" },
      { key: "benchmark", label: "Benchmark", format: "text" },
      { key: "gap", label: "Gap", format: "text" },
      { key: "period", label: "Period end", format: "date" },
      { key: "classification", label: "Classification", format: "text" },
      { key: "source", label: "Source", format: "text" }
    ],
    rows: entries.slice(0, MAX_ROWS).map((entry) => ({
      unit: entry.unit?.name || humanize(entry.unit?.key),
      type: humanize(entry.unit?.type || "other"),
      metric: entry.metric?.name || humanize(entry.metric?.key),
      current: formatPerformanceValue(entry.current.value, entry.metric),
      previous: entry.previous
        ? formatPerformanceValue(entry.previous.value, entry.metric)
        : null,
      trend: performanceTrendLabel(entry.trend),
      benchmark: entry.primaryBenchmark
        ? `${entry.primaryBenchmark.label || humanize(entry.primaryBenchmark.key)}: ${formatPerformanceValue(
            entry.primaryBenchmark.value,
            entry.metric
          )}`
        : null,
      gap: entry.primaryBenchmark ? performanceGapLabel(entry) : null,
      period: entry.current.period_end || null,
      classification: humanize(entry.current.data_classification || "unclassified"),
      source: entry.current.source_name || entry.current.source_ref || entry.current.source_kind || null
    })),
    provenance: provenance({ ...context, references: collectReferences(payload) })
  });

  const references = collectReferences(payload);
  if (references.length > 0) {
    blocks.push({
      id: "performance-evidence",
      type: "sources",
      title: "Cited performance evidence",
      items: references.slice(0, MAX_REFERENCES),
      provenance: provenance({ ...context, references })
    });
  }
  return blocks.slice(0, 24);
}

function timelineBlocks(payload, context) {
  const rows = bestRecordArray(payload);
  const dateKey = rows.length > 0
    ? findKey(rows[0], ["at", "created_at", "updated_at", "observed_at", "date", "timestamp"])
    : null;
  const sorted = dateKey
    ? [...rows].sort((left, right) => Date.parse(right[dateKey]) - Date.parse(left[dateKey]))
    : rows;
  const references = collectReferences(payload);
  const baseProvenance = provenance({ ...context, references });
  const table = tableBlock(sorted, "Timeline", baseProvenance);
  return table ? [table] : genericDataBlocks(payload, context);
}

function decisionBlocks(payload, kind, context) {
  const candidates = recordArrays(payload)
    .flat()
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .filter((item) => isDecision(item, kind))
    .slice(0, MAX_DECISIONS);
  const references = collectReferences(payload);
  const baseProvenance = provenance({ ...context, references });

  if (candidates.length === 0) return genericDataBlocks(payload, context);
  return candidates.map((item, index) => {
    const id = firstValue(item, kind === "approval"
      ? ["pending_id", "pendingId", "id", "operation_id"]
      : ["receipt_id", "receiptId", "id"]);
    const status = normalizeDecisionStatus(firstValue(item, ["status", "state", "lifecycle"]));
    return {
      id: `${kind}-${index + 1}`,
      type: "decision",
      kind,
      status,
      summary: String(firstValue(item, [
        "review_summary",
        "summary",
        "description",
        "title",
        "operation",
        "tool"
      ]) || `${humanize(kind)} ${status}`),
      pending_id: kind === "approval" ? stringValue(id) : "",
      receipt_id: kind === "receipt" ? stringValue(id) : "",
      details: decisionDetails(item),
      provenance: {
        ...baseProvenance,
        approval_id: kind === "approval" ? stringValue(id) : "",
        receipt_id: kind === "receipt" ? stringValue(id) : ""
      }
    };
  });
}

function tableBlock(rows, title, blockProvenance) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const primitiveRows = rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .slice(0, MAX_ROWS);
  if (primitiveRows.length === 0) return null;
  const keys = [...new Set(
    primitiveRows.flatMap((row) =>
      Object.keys(row).filter((key) => isPrimitive(row[key]))
    )
  )].slice(0, MAX_COLUMNS);
  if (keys.length === 0) return null;
  return {
    id: `table-${slug(title)}`,
    type: "table",
    title,
    searchable: true,
    columns: keys.map((key) => ({
      key,
      label: humanize(key),
      format: columnFormat(key, primitiveRows)
    })),
    rows: primitiveRows.map((row) =>
      Object.fromEntries(keys.map((key) => [key, primitiveOrNull(row[key])]))
    ),
    provenance: blockProvenance
  };
}

function timeSeriesBlock(rows, blockProvenance) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const dateKey = findKey(rows[0], ["date", "day", "week", "month", "at", "observed_at", "created_at"]);
  const numericKeys = Object.keys(rows[0]).filter((key) =>
    rows.some((row) => finiteNumber(row[key]) !== null)
  ).slice(0, 6);
  if (!dateKey || numericKeys.length === 0) return null;
  return {
    id: "trend",
    type: "timeseries",
    title: "Trend",
    series: numericKeys.map((key) => ({
      name: humanize(key),
      points: rows.slice(0, 300).map((row) => ({
        x: String(row[dateKey]),
        y: finiteNumber(row[key]) ?? 0
      }))
    })),
    provenance: blockProvenance
  };
}

function collectMetrics(payload, path = "", depth = 0, output = []) {
  if (depth > 4 || output.length >= MAX_METRICS * 2) return output;
  if (!payload || typeof payload !== "object") return output;
  for (const [key, value] of Object.entries(payload)) {
    if (output.length >= MAX_METRICS * 2) break;
    const nextPath = path ? `${path}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      output.push({ path: nextPath, value });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      collectMetrics(value, nextPath, depth + 1, output);
    }
  }
  return output;
}

function collectReferences(payload) {
  const references = [];
  walk(payload, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const id = firstValue(value, ["id", "receipt_id", "pending_id", "goal_id", "campaign_id", "record_id"]);
    const label = firstValue(value, ["label", "title", "name", "summary", "operation", "tool"]);
    if (id && label) {
      references.push({
        type: inferReferenceType(value),
        id: String(id),
        label: cleanText(label, 240),
        observed_at: validDate(firstValue(value, [
          "observed_at",
          "updated_at",
          "created_at",
          "completed_at"
        ]))
      });
    }
    const sourceRef = stringValue(value.source_ref).trim();
    if (sourceRef) {
      references.push({
        type: cleanText(value.source_kind || "evidence", 80),
        id: cleanText(sourceRef, 160),
        label: cleanText(
          value.source_name
            ? `${value.source_name} — ${sourceRef}`
            : sourceRef,
          240
        ),
        observed_at: validDate(value.observed_at)
      });
    }
    if (Array.isArray(value.evidence_refs)) {
      for (const evidenceRef of value.evidence_refs.slice(0, MAX_REFERENCES)) {
        const id = cleanText(evidenceRef, 160);
        if (!id) continue;
        references.push({
          type: "evidence",
          id,
          label: cleanText(evidenceRef, 240),
          observed_at: ""
        });
      }
    }
  });
  return dedupeReferences(references);
}

function recordArrays(payload) {
  const arrays = [];
  walk(payload, (value) => {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => item && typeof item === "object" && !Array.isArray(item))
    ) {
      arrays.push(value);
    }
  });
  return arrays;
}

function bestRecordArray(payload) {
  return recordArrays(payload)
    .sort((left, right) => scoreRows(right) - scoreRows(left))[0]
    ?.slice(0, MAX_ROWS) || [];
}

function unwrapResult(value) {
  const text = firstText(value);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { summary: text };
    }
  }
  if (value?.result && typeof value.result === "object") return value.result;
  return value && typeof value === "object" ? value : { summary: String(value || "") };
}

function firstText(value) {
  if (typeof value?.text === "string" && value.text.trim()) return value.text.trim();
  const content = value?.content || value?.result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function resultState(payload) {
  const error = firstValue(payload, ["error", "error_message"]);
  if (error) return { kind: "error", message: cleanText(error, 500) };
  const permission = firstValue(payload, ["permission_denied", "forbidden", "missing_scope"]);
  if (permission) {
    return {
      kind: "restricted",
      message: typeof permission === "string"
        ? cleanText(permission, 500)
        : "Some company data is outside the current user's authority."
    };
  }
  const partial = Boolean(firstValue(payload, ["partial", "truncated", "incomplete"]));
  if (partial) {
    return {
      kind: "partial",
      message: "This view contains the available result; some data was partial or unavailable."
    };
  }
  if (
    String(payload?.status || "").toLowerCase() === "empty" &&
    Array.isArray(payload?.operating_units) &&
    payload.operating_units.length === 0
  ) {
    return { kind: "empty", message: "No matching company performance data is currently available." };
  }
  if (isEmpty(payload)) {
    return { kind: "empty", message: "No matching company data is currently available." };
  }
  return { kind: "ready", message: "" };
}

function inferIntent(sourceTool, payload) {
  const name = String(sourceTool || "").toLowerCase();
  const keys = JSON.stringify(Object.keys(payload || {})).toLowerCase();
  if (/approval|pending_operation/.test(name + keys)) return "approvals";
  if (/receipt|proof/.test(name + keys)) return "receipts";
  if (
    /performance_snapshot|performance_units/.test(name + keys) ||
    (Array.isArray(payload?.operating_units) && payload?.goal_signal_pattern)
  ) return "performance";
  const learningShape = [
    name,
    keys,
    String(payload?.resource || ""),
    String(payload?.item?.type || payload?.course?.type || ""),
    Array.isArray(payload?.item?.modules) || Array.isArray(payload?.course?.modules)
      ? "modules"
      : ""
  ].join(" ").toLowerCase();
  if (/learning|course|curriculum|module/.test(learningShape)) return "learning";
  if (/funnel|conversion/.test(name + keys)) return "funnel";
  if (/cohort/.test(name + keys)) return "cohort";
  if (/timeline|activity|event/.test(name + keys)) return "timeline";
  if (/compare|comparison/.test(name + keys)) return "comparison";
  if (/goal|work|task|operation/.test(name + keys)) return "live_work";
  if (/overview|resume_company/.test(name)) return "company_overview";
  return "kpi";
}

function titleForIntent(intent) {
  return {
    company_overview: "Company operating view",
    performance: "Company performance",
    learning: "Learning course",
    kpi: "Company metrics",
    funnel: "Conversion funnel",
    cohort: "Cohort view",
    timeline: "Company timeline",
    comparison: "Company comparison",
    approvals: "Approval queue",
    receipts: "Proof and receipts",
    live_work: "Live company work"
  }[intent] || "Company operating view";
}

function subtitleForIntent(intent) {
  if (intent === "performance") {
    return "Current and prior results, relevant benchmark gaps, and cited source evidence.";
  }
  if (intent === "learning") {
    return "Course structure, status, evidence, and the governed review destination.";
  }
  if (intent === "approvals") return "Current governed decisions waiting for human authority.";
  if (intent === "receipts") return "Recorded outcomes with their available proof and provenance.";
  if (intent === "live_work") return "Current work, decisions, and operating evidence.";
  return "A deterministic view of the current AMOS result.";
}

function safeLearningUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return "";
    if (url.username || url.password) return "";
    for (const key of url.searchParams.keys()) {
      if (/(?:token|secret|password|signature|api[_-]?key|access[_-]?key|code)/i.test(key)) {
        return "";
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function provenance({
  sourceTool,
  observedAt,
  tenantId = "",
  references = [],
  uncertainty = "none"
}) {
  return {
    source_kind: "live",
    source_label: humanize(sourceTool || "AMOS company data"),
    tenant_id: stringValue(tenantId),
    observed_at: observedAt,
    uncertainty,
    references: references.slice(0, MAX_REFERENCES)
  };
}

function decisionDetails(item) {
  return Object.entries(item)
    .filter(([key, value]) =>
      !["id", "pending_id", "receipt_id", "summary", "review_summary", "description"].includes(key) &&
      isPrimitive(value)
    )
    .slice(0, 12)
    .map(([key, value]) => ({ label: humanize(key), value: primitiveOrNull(value) }));
}

function isDecision(item, kind) {
  const keys = Object.keys(item).join(" ").toLowerCase();
  if (kind === "approval") {
    return /pending|approval|operation/.test(keys) || String(item.status || "").toLowerCase() === "pending";
  }
  return /receipt|proof/.test(keys) || Boolean(item.receipt_id);
}

function normalizeDecisionStatus(value) {
  const normalized = String(value || "pending").toLowerCase();
  if (["pending", "approved", "denied", "executed", "failed", "expired", "attention"].includes(normalized)) {
    return normalized;
  }
  if (["complete", "completed", "success", "succeeded"].includes(normalized)) return "executed";
  if (["rejected", "canceled", "cancelled"].includes(normalized)) return "denied";
  return "attention";
}

function conversionLabel(previous, current) {
  const left = finiteNumber(previous);
  const right = finiteNumber(current);
  if (left === null || right === null || left === 0) return "";
  return `${((right / left) * 100).toFixed(1)}% from prior stage`;
}

function formatPerformanceValue(value, metric = {}) {
  const numeric = finiteNumber(value);
  if (numeric === null) return "—";
  if (metric.value_kind === "percent") {
    return `${formatNumber(numeric * 100)}%`;
  }
  if (metric.value_kind === "currency") {
    return `${formatNumber(numeric)} ${metric.unit || "currency"}`;
  }
  const rendered = formatNumber(numeric);
  return metric.unit ? `${rendered} ${metric.unit}` : rendered;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function performanceTone(entry) {
  if (entry.attention) return "down";
  if (entry.primaryBenchmark?.gap?.meets_or_exceeds === true) return "up";
  if (entry.trend?.favorable === true) return "up";
  if (entry.trend?.favorable === false) return "down";
  return "neutral";
}

function performanceChange(entry) {
  if (entry.primaryBenchmark) return performanceGapLabel(entry);
  return performanceTrendLabel(entry.trend);
}

function performanceGapLabel(entry) {
  const label = entry.primaryBenchmark?.label || humanize(entry.primaryBenchmark?.key);
  if (entry.primaryBenchmark?.gap?.meets_or_exceeds === true) {
    return `Meets or exceeds ${label}`;
  }
  const shortfall = formatPerformanceValue(entry.shortfall, entry.metric);
  return `${shortfall} to ${label}`;
}

function performanceTrendLabel(trend) {
  if (!trend) return "";
  const direction = humanize(trend.direction || "flat");
  if (trend.favorable === true) return `${direction} vs prior (favorable)`;
  if (trend.favorable === false) return `${direction} vs prior (unfavorable)`;
  return `${direction} vs prior`;
}

function textSummary(payload) {
  for (const key of ["summary", "brief", "message", "description", "text"]) {
    if (typeof payload?.[key] === "string" && payload[key].trim()) {
      return cleanText(payload[key], 20_000);
    }
  }
  return "";
}

function scoreRows(rows) {
  if (!rows.length) return 0;
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  return Math.min(rows.length, MAX_ROWS) * Math.min(keys.size, MAX_COLUMNS);
}

function findKey(record, preferred) {
  const keys = Object.keys(record || {});
  return preferred.find((candidate) => keys.includes(candidate)) || null;
}

function findNumericKey(record, preferred) {
  const direct = preferred.find((candidate) => finiteNumber(record?.[candidate]) !== null);
  if (direct) return direct;
  return Object.keys(record || {}).find((key) => finiteNumber(record[key]) !== null) || null;
}

function columnFormat(key, rows) {
  const lowered = key.toLowerCase();
  if (/amount|spend|cost|price|revenue|mrr|arr|balance/.test(lowered)) return "currency";
  if (/percent|percentage|rate|conversion/.test(lowered)) return "percent";
  if (/date|_at$|timestamp/.test(lowered)) return "datetime";
  if (rows.some((row) => typeof row[key] === "number")) return "number";
  return "text";
}

function inferReferenceType(value) {
  const keys = Object.keys(value).join(" ").toLowerCase();
  if (keys.includes("receipt")) return "receipt";
  if (keys.includes("pending") || keys.includes("approval")) return "approval";
  if (keys.includes("goal")) return "goal";
  if (keys.includes("campaign")) return "campaign";
  return "record";
}

function dedupeReferences(references) {
  const seen = new Set();
  return references.filter((reference) => {
    const key = `${reference.type}:${reference.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(reference.label);
  });
}

function firstValue(value, keys) {
  for (const key of keys) {
    if (value && value[key] !== undefined && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }
  return null;
}

function findDeepValue(value, keys) {
  let found = null;
  walk(value, (candidate) => {
    if (found !== null || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    found = firstValue(candidate, keys);
  });
  return found;
}

function walk(value, visitor, depth = 0, seen = new Set()) {
  if (depth > 5 || !value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    walk(child, visitor, depth + 1, seen);
  }
}

function validDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Date(value).toISOString();
}

function isEmpty(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isPrimitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function primitiveOrNull(value) {
  if (value === undefined || typeof value === "object") return null;
  return value;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function humanize(value) {
  return String(value || "")
    .replace(/^amos_/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function slug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "item";
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
