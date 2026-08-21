const MAX_TEMPLATES = 100;
const MAX_BLUEPRINTS = 20;
const MAX_OPERATIONS = 100;
const MAX_MAPPING_ROWS = 64;
const MAX_JSON_BYTES = 256 * 1024;
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const AUTOMATION_SETUP_PHASES = Object.freeze([
  "intent",
  "connections",
  "mapping",
  "trigger",
  "preview",
  "activate"
]);

export function emptyAutomationTemplateCatalog() {
  return {
    supported: false,
    catalogVersion: 0,
    blueprints: [],
    templates: [],
    installationContract: "",
    standingGrantContract: { supported: false, defaultMode: "per_run", fallback: "" },
    operatorSetupContract: { primarySurface: "", sequence: [] }
  };
}

export function normalizeAutomationTemplateCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AMOS Automation templates returned an invalid response");
  }
  const templates = (Array.isArray(value.templates) ? value.templates : [])
    .slice(0, MAX_TEMPLATES)
    .map(normalizeTemplate)
    .filter(Boolean);
  const blueprints = (Array.isArray(value.blueprints) ? value.blueprints : [])
    .slice(0, MAX_BLUEPRINTS)
    .map(normalizeBlueprint)
    .filter(Boolean);
  const operator = objectOrEmpty(value.operator_setup_contract);
  const standing = objectOrEmpty(value.standing_grant_contract);
  return {
    supported: true,
    catalogVersion: boundedInteger(value.catalog_version, 0, Number.MAX_SAFE_INTEGER, 0),
    blueprints,
    templates,
    installationContract: text(value.installation_contract, 2_000),
    standingGrantContract: {
      supported: Object.keys(standing).length > 0,
      defaultMode: text(standing.default || "per_run", 40),
      appliesTo: text(standing.applies_to, 500),
      binding: stringArray(standing.binding, 20, 200),
      fallback: text(standing.fallback, 2_000)
    },
    operatorSetupContract: {
      primarySurface: text(operator.primary_surface, 200),
      sequence: (Array.isArray(operator.sequence) ? operator.sequence : [])
        .slice(0, 20)
        .flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const phase = text(item.phase, 80);
          if (!phase) return [];
          return [{
            phase,
            outcome: text(item.outcome, 1_000),
            modes: stringArray(item.modes, 20, 80),
            tools: stringArray(item.tools, 30, 120)
          }];
        })
    }
  };
}

export function normalizeAutomationOperations(value, requestedConnection = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AMOS connection operations returned an invalid response");
  }
  return {
    connectionId: text(value.connection_id || requestedConnection, 128),
    provider: text(value.provider, 80),
    contracts: (Array.isArray(value.contracts) ? value.contracts : [])
      .slice(0, MAX_OPERATIONS)
      .map(normalizeOperation)
      .filter(Boolean),
    note: text(value.note, 1_000)
  };
}

export function automationInstallArguments(input, { catalog, connections, contracts = [] }) {
  const templateKey = requiredText(input?.templateKey, 120, "Automation template");
  const template = catalog?.templates?.find((item) => item.key === templateKey);
  if (!template) throw new Error("Select an Automation template advertised by AMOS Platform");
  if (!template.installable) {
    throw new Error(template.whyGuided || "This workflow requires a guided custom design");
  }
  const name = requiredText(input?.name, 160, "Automation name");
  const supplied = cloneBoundedObject(input?.parameters || {}, "Automation parameters");
  const allowed = new Set([...template.requiredParameters, ...template.optionalParameters]);
  for (const key of Object.keys(supplied)) {
    if (!allowed.has(key)) throw new Error(`The ${template.title} template does not accept '${key}'`);
  }
  for (const key of template.requiredParameters) {
    if (!hasMaterialValue(supplied[key])) throw new Error(`${humanize(key)} is required`);
  }

  for (const [key, label] of [
    ["connection", "Connection"],
    ["source_connection", "Source connection"],
    ["destination_connection", "Destination connection"]
  ]) {
    if (!allowed.has(key)) continue;
    supplied[key] = resolveUsableConnection(supplied[key], connections, label);
  }
  if (
    allowed.has("source_connection") &&
    allowed.has("destination_connection") &&
    supplied.source_connection === supplied.destination_connection
  ) {
    throw new Error("Choose different connected systems for the source and destination");
  }
  if (allowed.has("operation")) {
    const operation = requiredText(supplied.operation, 64, "Connection operation");
    const contract = contracts.find(
      (item) => item.operationKey === operation && item.status === "active"
    );
    if (!contract) throw new Error("Select an active operation contract for this connection");
    supplied.operation = operation;
  }
  if (supplied.cadence !== undefined) supplied.cadence = normalizeAutomationCadence(supplied.cadence);
  if (supplied.metric_keys !== undefined) {
    const values = stringArray(supplied.metric_keys, 200, 120);
    if (values.length === 0) throw new Error("Choose at least one initiative metric");
    supplied.metric_keys = values;
  }
  if (supplied.webhook !== undefined) {
    supplied.webhook = requiredIdentifier(supplied.webhook, 120, "Webhook event");
  }
  if (supplied.event_types !== undefined) {
    supplied.event_types = stringArray(supplied.event_types, 50, 160);
    if (supplied.event_types.length === 0) throw new Error("Choose at least one source event type");
  }
  if (supplied.collection !== undefined) {
    supplied.collection = requiredIdentifier(supplied.collection, 120, "AMOS collection");
  }
  if (supplied.unit_key !== undefined) supplied.unit_key = requiredText(supplied.unit_key, 160, "Operating unit");
  if (supplied.arguments !== undefined) {
    supplied.arguments = cloneBoundedObject(supplied.arguments, "Field mappings");
    validateReferences(supplied.arguments);
  }
  if (supplied.filter !== undefined) supplied.filter = cloneBoundedObject(supplied.filter, "Record filter");
  if (supplied.backfill !== undefined) supplied.backfill = supplied.backfill === true;
  if (supplied.standing_grant !== undefined) {
    supplied.standing_grant = normalizeStandingGrantRequest(supplied.standing_grant);
  }

  return { template_key: templateKey, name, parameters: supplied };
}

export function normalizeStandingGrantRequest(value, now = new Date()) {
  const grant = objectOrEmpty(value);
  const window = text(grant.window, 20);
  if (!["hour", "day"].includes(window)) {
    throw new Error("Standing authority must use an hourly or daily window");
  }
  const maxRunsPerWindow = boundedInteger(grant.max_runs_per_window, 1, 1_000_000, 0);
  const maxTotalRuns = boundedInteger(grant.max_total_runs, 1, 1_000_000_000, 0);
  const maxConsecutiveFailures = boundedInteger(grant.max_consecutive_failures, 1, 100, 0);
  if (!maxRunsPerWindow || !maxTotalRuns || !maxConsecutiveFailures) {
    throw new Error("Standing authority requires positive rate, lifetime, and failure limits");
  }
  const expires = new Date(grant.expires_at);
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(expires.getTime()) || expires <= current) {
    throw new Error("Standing authority must expire in the future");
  }
  if (expires.getTime() > current.getTime() + (366 * 24 * 60 * 60 * 1000)) {
    throw new Error("Standing authority may last no more than 366 days");
  }
  return {
    window,
    max_runs_per_window: maxRunsPerWindow,
    max_total_runs: maxTotalRuns,
    max_consecutive_failures: maxConsecutiveFailures,
    expires_at: expires.toISOString()
  };
}

export function normalizeAutomationInstallation(value) {
  if (!value || typeof value !== "object" || value.installed !== true) {
    throw new Error("AMOS did not confirm that the Automation draft was installed");
  }
  const automation = objectOrEmpty(value.automation);
  const activation = objectOrEmpty(value.activation);
  const activationArguments = cloneBoundedObject(
    activation.arguments || {},
    "Automation activation contract"
  );
  if (activation.tool !== "set_automation" || !activationArguments.name) {
    throw new Error("AMOS returned an invalid Automation activation contract");
  }
  return {
    installed: true,
    catalogVersion: boundedInteger(value.catalog_version, 0, Number.MAX_SAFE_INTEGER, 0),
    automation: {
      id: text(automation.id, 128),
      name: text(automation.name || activationArguments.name, 160),
      status: text(automation.status || "draft", 40),
      templateKey: text(automation.template_key || activationArguments.template_key, 120),
      templateVersion: boundedInteger(
        automation.template_version || activationArguments.template_version,
        0,
        Number.MAX_SAFE_INTEGER,
        0
      ),
      blueprintKey: text(automation.blueprint_key || activationArguments.blueprint_key, 120)
    },
    receiptId: text(value.receipt_id, 128),
    activation: {
      required: activation.required !== false,
      tool: "set_automation",
      arguments: activationArguments,
      note: text(activation.note, 2_000)
    },
    desktopNextStep: text(value.desktop_next_step, 2_000)
  };
}

export function publicAutomationInstallation(value) {
  return {
    installed: value.installed,
    catalogVersion: value.catalogVersion,
    automation: structuredClone(value.automation),
    receiptId: value.receiptId,
    activation: {
      required: value.activation.required,
      note: value.activation.note,
      preview: {
        trigger: cloneBounded(value.activation.arguments.trigger, "Automation trigger"),
        steps: cloneBounded(value.activation.arguments.steps, "Automation steps")
      }
    },
    desktopNextStep: value.desktopNextStep
  };
}

export function mappingRowsForOperation(contract) {
  if (!contract) return [];
  const rows = [];
  collectSchemaRows(contract.pathParamsSchema, "path_params", rows, new Set(), 0);
  collectSchemaRows(contract.querySchema, "query", rows, new Set(), 0);
  if (contract.bodySchema) collectSchemaRows(contract.bodySchema, "body", rows, new Set(), 0);
  return rows.slice(0, MAX_MAPPING_ROWS);
}

export function compileAutomationMappings(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_MAPPING_ROWS) {
    throw new Error(`Field mappings must contain at most ${MAX_MAPPING_ROWS} rows`);
  }
  const result = {};
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object") throw new Error(`Mapping ${index + 1} is invalid`);
    const destination = requiredMappingPath(row.destination, `Mapping ${index + 1} destination`);
    let value;
    if (row.mode === "reference") {
      const reference = requiredText(row.value, 512, `Mapping ${index + 1} source field`);
      if (!/^trigger(?:\.[A-Za-z0-9_-]+)+$/.test(reference)) {
        throw new Error(`Mapping ${index + 1} must reference a trigger field such as trigger.payload.customer.id`);
      }
      value = { $ref: reference };
    } else if (row.mode === "constant") {
      value = parseConstant(row.value);
    } else {
      throw new Error(`Mapping ${index + 1} must use a source field or constant`);
    }
    setPath(result, destination.split("."), value);
  }
  validateReferences(result);
  return cloneBoundedObject(result, "Field mappings");
}

export function previewAutomationMappings(argumentsValue, sampleContext) {
  const mappings = cloneBoundedObject(argumentsValue || {}, "Field mappings");
  const context = cloneBoundedObject(sampleContext || {}, "Sample trigger payload");
  return resolveReferences(mappings, context, 0);
}

export function normalizeAutomationCadence(value) {
  const cadence = objectOrEmpty(value);
  const kind = text(cadence.kind, 20);
  if (kind === "interval") {
    return { kind, every_minutes: boundedInteger(cadence.every_minutes, 60, 10_080) };
  }
  if (kind === "daily") {
    return {
      kind,
      hour_utc: boundedInteger(cadence.hour_utc, 0, 23),
      minute_utc: boundedInteger(cadence.minute_utc, 0, 59)
    };
  }
  if (kind === "weekly") {
    return {
      kind,
      weekday: boundedInteger(cadence.weekday, 0, 6),
      hour_utc: boundedInteger(cadence.hour_utc, 0, 23),
      minute_utc: boundedInteger(cadence.minute_utc, 0, 59)
    };
  }
  throw new Error("Choose an interval, daily, or weekly schedule");
}

function normalizeTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = text(value.key, 120);
  const title = text(value.title, 200);
  if (!key || !title) return null;
  return {
    key,
    version: boundedInteger(value.version, 1, Number.MAX_SAFE_INTEGER, 1),
    blueprintKey: text(value.blueprint, 120),
    title,
    description: text(value.description, 1_000),
    installable: value.installable === true,
    buildMode: text(value.build_mode, 40),
    whyGuided: text(value.why_guided, 1_000),
    triggerModes: stringArray(value.trigger_modes, 10, 40),
    requiredPrimitives: stringArray(value.required_primitives, 30, 120),
    requiredParameters: stringArray(value.required_parameters, 30, 120),
    optionalParameters: stringArray(value.optional_parameters, 30, 120),
    modelRequiredForRun: value.model_required_for_run === true
  };
}

function normalizeBlueprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = text(value.key, 120);
  const title = text(value.title, 200);
  if (!key || !title) return null;
  return {
    key,
    title,
    description: text(value.description, 1_000),
    templates: stringArray(value.templates, MAX_TEMPLATES, 120)
  };
}

function normalizeOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contractId = text(value.contract_id, 128);
  const operationKey = text(value.operation_key, 64);
  if (!contractId || !operationKey) return null;
  return {
    contractId,
    operationKey,
    displayName: text(value.display_name || operationKey, 200),
    consequence: value.consequence === "write" ? "write" : "read",
    method: text(value.method, 12),
    pathTemplate: text(value.path_template, 1_000),
    pathParamsSchema: cloneBoundedObject(value.path_params_schema || {}, "Path schema"),
    querySchema: cloneBoundedObject(value.query_schema || {}, "Query schema"),
    bodySchema: value.body_schema
      ? cloneBoundedObject(value.body_schema, "Body schema")
      : null,
    status: text(value.status || "active", 40),
    activatedAt: text(value.activated_at, 80)
  };
}

function collectSchemaRows(schema, prefix, rows, parentRequired, depth) {
  if (!schema || typeof schema !== "object" || depth > 12 || rows.length >= MAX_MAPPING_ROWS) return;
  const properties = objectOrEmpty(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  if (Object.keys(properties).length === 0) {
    if (schema.type === "object") return;
    rows.push({
      destination: prefix,
      label: text(schema.description || humanize(prefix.split(".").at(-1)), 200),
      type: text(schema.type || "value", 40),
      required: parentRequired.has(prefix.split(".").at(-1))
    });
    return;
  }
  for (const [key, child] of Object.entries(properties)) {
    if (BLOCKED_KEYS.has(key)) continue;
    const path = `${prefix}.${key}`;
    const childProperties = objectOrEmpty(child?.properties);
    if (Object.keys(childProperties).length > 0) {
      collectSchemaRows(child, path, rows, required, depth + 1);
    } else {
      rows.push({
        destination: path,
        label: text(child?.description || humanize(key), 200),
        type: text(child?.type || "value", 40),
        required: required.has(key)
      });
    }
    if (rows.length >= MAX_MAPPING_ROWS) break;
  }
}

function resolveReferences(value, context, depth) {
  if (depth > 20) throw new Error("Sample mapping exceeds the supported depth");
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, context, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && typeof value.$ref === "string") {
    let current = context;
    for (const segment of value.$ref.split(".")) {
      if (!segment || BLOCKED_KEYS.has(segment)) throw new Error(`Unsafe sample reference '${value.$ref}'`);
      current = Array.isArray(current) && /^\d+$/.test(segment)
        ? current[Number(segment)]
        : current?.[segment];
      if (current === undefined) throw new Error(`Sample payload does not contain '${value.$ref}'`);
    }
    return structuredClone(current);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveReferences(item, context, depth + 1)])
  );
}

function validateReferences(value, depth = 0) {
  if (depth > 20) throw new Error("Automation mappings exceed the supported depth");
  if (Array.isArray(value)) {
    for (const item of value) validateReferences(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0][0] === "$ref") {
    const reference = requiredText(entries[0][1], 512, "Automation mapping reference");
    if (!/^trigger(?:\.[A-Za-z0-9_-]+)+$/.test(reference)) {
      throw new Error("Automation mapping references must start with trigger.");
    }
    return;
  }
  for (const [key, item] of entries) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`Automation parameters contain blocked key '${key}'`);
    validateReferences(item, depth + 1);
  }
}

function setPath(target, segments, value) {
  let current = target;
  for (const [index, segment] of segments.entries()) {
    if (!segment || BLOCKED_KEYS.has(segment)) throw new Error("Mapping destination contains an unsafe field");
    if (index === segments.length - 1) {
      if (Object.hasOwn(current, segment)) throw new Error(`Destination '${segments.join(".")}' is mapped more than once`);
      current[segment] = value;
    } else {
      if (current[segment] === undefined) current[segment] = {};
      if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
        throw new Error(`Mapping destination '${segments.join(".")}' conflicts with another mapping`);
      }
      current = current[segment];
    }
  }
}

function requiredMappingPath(value, label) {
  const path = requiredText(value, 512, label);
  if (!/^(?:path_params|query|body)(?:\.[A-Za-z0-9_-]+)*$/.test(path)) {
    throw new Error(`${label} must begin with path_params, query, or body`);
  }
  return path;
}

function parseConstant(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(0, 10_000);
  }
}

function cloneBoundedObject(value, label) {
  const cloned = cloneBounded(value, label);
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new Error(`${label} must be an object`);
  }
  return cloned;
}

function cloneBounded(value, label) {
  let encoded;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw new Error(`${label} must be valid JSON data`);
  }
  if (encoded.length > MAX_JSON_BYTES) throw new Error(`${label} is too large`);
  const cloned = JSON.parse(encoded);
  rejectBlockedKeys(cloned, label, 0);
  return cloned;
}

function rejectBlockedKeys(value, label, depth) {
  if (depth > 20) throw new Error(`${label} exceeds the supported depth`);
  if (Array.isArray(value)) {
    for (const item of value) rejectBlockedKeys(item, label, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`${label} contains blocked key '${key}'`);
    rejectBlockedKeys(item, label, depth + 1);
  }
}

function requiredIdentifier(value, max, label) {
  const result = requiredText(value, max, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(result)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return result;
}

function requiredText(value, max, label) {
  const result = text(value, max);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function stringArray(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : [])
    .slice(0, maxItems)
    .map((item) => text(item, maxLength))
    .filter(Boolean);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedInteger(value, min, max, fallback = null) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    if (fallback !== null) return fallback;
    throw new Error(`Value must be an integer between ${min} and ${max}`);
  }
  return number;
}

function hasMaterialValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function resolveUsableConnection(value, connections, label) {
  const connection = requiredText(value, 128, label);
  const current = (Array.isArray(connections) ? connections : []).find(
    (item) => item.usable === true && (item.id === connection || item.provider === connection)
  );
  if (!current) throw new Error(`Select a connected ${label.toLowerCase()} available to this AMOS identity`);
  return current.id || current.provider;
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
