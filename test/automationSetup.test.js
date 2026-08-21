import test from "node:test";
import assert from "node:assert/strict";
import {
  automationInstallArguments,
  compileAutomationMappings,
  mappingRowsForOperation,
  normalizeAutomationInstallation,
  normalizeAutomationOperations,
  normalizeStandingGrantRequest,
  normalizeAutomationTemplateCatalog,
  previewAutomationMappings,
  publicAutomationInstallation
} from "../src/desktop/automationSetup.js";
import { createAutomationSetupTool } from "../src/tools/automationSetup.js";
import { DesktopController } from "../src/desktop/controller.js";

const catalogPayload = {
  catalog_version: 1,
  blueprints: [{
    key: "connected_operations",
    title: "Connected Operations",
    description: "Move data deterministically.",
    templates: ["event_driven_system_sync"]
  }],
  templates: [{
    key: "event_driven_system_sync",
    version: 1,
    blueprint: "connected_operations",
    title: "Event-Driven System Synchronization",
    description: "Move a signed event into a connected system.",
    installable: true,
    trigger_modes: ["webhook"],
    required_parameters: ["webhook", "connection", "operation"],
    optional_parameters: ["arguments", "standing_grant"],
    model_required_for_run: false
  }, {
    key: "cross_system_event_sync",
    version: 1,
    blueprint: "connected_operations",
    title: "Cross-System Event Synchronization",
    description: "Move one connected-system event into another system.",
    installable: true,
    trigger_modes: ["webhook"],
    required_parameters: ["webhook", "source_connection", "destination_connection", "operation"],
    optional_parameters: ["event_types", "arguments", "standing_grant"],
    model_required_for_run: false
  }],
  operator_setup_contract: {
    primary_surface: "AMOS Desktop Operator conversation",
    sequence: [{ phase: "mapping", outcome: "Show every mapping." }]
  },
  standing_grant_contract: {
    default: "per_run",
    applies_to: "typed writes only",
    binding: ["definition", "mapping", "contract"],
    fallback: "Park for per-run approval."
  }
};

const operationPayload = {
  connection_id: "11111111-1111-4111-8111-111111111111",
  provider: "quickbooks",
  contracts: [{
    contract_id: "22222222-2222-4222-8222-222222222222",
    operation_key: "create_invoice",
    display_name: "Create invoice",
    consequence: "write",
    method: "POST",
    path_template: "/v3/company/{company_id}/invoice",
    path_params_schema: {
      type: "object",
      additionalProperties: false,
      required: ["company_id"],
      properties: { company_id: { type: "string", description: "QuickBooks company" } }
    },
    query_schema: { type: "object", additionalProperties: false },
    body_schema: {
      type: "object",
      additionalProperties: false,
      required: ["customer_id", "amount"],
      properties: {
        customer_id: { type: "string", description: "Customer" },
        amount: { type: "number", description: "Invoice amount" },
        memo: { type: "string", description: "Memo" }
      }
    },
    status: "active"
  }]
};

test("guided Automation catalog remains Platform-owned and exposes the operator sequence", () => {
  const catalog = normalizeAutomationTemplateCatalog(catalogPayload);

  assert.equal(catalog.supported, true);
  assert.equal(catalog.templates[0].key, "event_driven_system_sync");
  assert.equal(catalog.templates[0].modelRequiredForRun, false);
  assert.equal(catalog.operatorSetupContract.sequence[0].phase, "mapping");
  assert.equal(catalog.standingGrantContract.supported, true);
});

test("operation schemas become visible mapping rows and compile exact typed references", () => {
  const operations = normalizeAutomationOperations(operationPayload, "quickbooks");
  const rows = mappingRowsForOperation(operations.contracts[0]);

  assert.deepEqual(rows.map((row) => [row.destination, row.required]), [
    ["path_params.company_id", true],
    ["body.customer_id", true],
    ["body.amount", true],
    ["body.memo", false]
  ]);

  const mappings = compileAutomationMappings([
    { destination: "path_params.company_id", mode: "constant", value: "company-7" },
    { destination: "body.customer_id", mode: "reference", value: "trigger.payload.customer.id" },
    { destination: "body.amount", mode: "reference", value: "trigger.payload.total" }
  ]);
  assert.deepEqual(mappings, {
    path_params: { company_id: "company-7" },
    body: {
      customer_id: { $ref: "trigger.payload.customer.id" },
      amount: { $ref: "trigger.payload.total" }
    }
  });
  assert.deepEqual(
    previewAutomationMappings(mappings, {
      trigger: { payload: { customer: { id: "customer-9" }, total: 125.5 } }
    }),
    {
      path_params: { company_id: "company-7" },
      body: { customer_id: "customer-9", amount: 125.5 }
    }
  );
});

test("install arguments accept only live connections, active operations, and advertised parameters", () => {
  const catalog = normalizeAutomationTemplateCatalog(catalogPayload);
  const operations = normalizeAutomationOperations(operationPayload);
  const args = automationInstallArguments({
    templateKey: "event_driven_system_sync",
    name: "Stripe invoices into QuickBooks",
    parameters: {
      webhook: "stripe.invoice.created",
      connection: "quickbooks",
      operation: "create_invoice",
      arguments: {
        body: { customer_id: { $ref: "trigger.payload.customer.id" } }
      }
    }
  }, {
    catalog,
    connections: [{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "quickbooks",
      usable: true
    }],
    contracts: operations.contracts
  });

  assert.equal(args.parameters.connection, "11111111-1111-4111-8111-111111111111");
  assert.equal(args.parameters.operation, "create_invoice");
  assert.throws(
    () => automationInstallArguments({
      templateKey: "event_driven_system_sync",
      name: "Unsafe",
      parameters: {
        webhook: "stripe.invoice.created",
        connection: "quickbooks",
        operation: "delete_everything"
      }
    }, {
      catalog,
      connections: [{ provider: "quickbooks", usable: true }],
      contracts: operations.contracts
    }),
    /active operation contract/i
  );
});

test("bounded standing authority is normalized and remains an explicit template parameter", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const grant = normalizeStandingGrantRequest({
    window: "hour",
    max_runs_per_window: 500,
    max_total_runs: 100_000,
    max_consecutive_failures: 5,
    expires_at: "2026-11-01T00:00:00.000Z"
  }, now);
  assert.deepEqual(grant, {
    window: "hour",
    max_runs_per_window: 500,
    max_total_runs: 100_000,
    max_consecutive_failures: 5,
    expires_at: "2026-11-01T00:00:00.000Z"
  });
  assert.throws(
    () => normalizeStandingGrantRequest({ ...grant, expires_at: "2028-01-01T00:00:00.000Z" }, now),
    /no more than 366 days/i
  );

  const catalog = normalizeAutomationTemplateCatalog(catalogPayload);
  const operations = normalizeAutomationOperations(operationPayload);
  const args = automationInstallArguments({
    templateKey: "event_driven_system_sync",
    name: "Invoice sync",
    parameters: {
      webhook: "stripe.invoice.created",
      connection: "quickbooks",
      operation: "create_invoice",
      standing_grant: grant
    }
  }, {
    catalog,
    connections: [{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "quickbooks",
      usable: true
    }],
    contracts: operations.contracts
  });
  assert.equal(args.parameters.standing_grant.window, "hour");
  assert.equal(args.parameters.standing_grant.max_total_runs, 100_000);
});

test("cross-system install arguments preserve distinct source and destination roles", () => {
  const catalog = normalizeAutomationTemplateCatalog(catalogPayload);
  const operations = normalizeAutomationOperations(operationPayload);
  const args = automationInstallArguments({
    templateKey: "cross_system_event_sync",
    name: "Stripe invoices into QuickBooks",
    parameters: {
      webhook: "stripe-events",
      source_connection: "stripe",
      destination_connection: "quickbooks",
      operation: "create_invoice",
      event_types: ["invoice.finalized", "invoice.paid"]
    }
  }, {
    catalog,
    connections: [{
      id: "33333333-3333-4333-8333-333333333333",
      provider: "stripe",
      usable: true
    }, {
      id: "11111111-1111-4111-8111-111111111111",
      provider: "quickbooks",
      usable: true
    }],
    contracts: operations.contracts
  });

  assert.equal(args.parameters.source_connection, "33333333-3333-4333-8333-333333333333");
  assert.equal(args.parameters.destination_connection, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(args.parameters.event_types, ["invoice.finalized", "invoice.paid"]);
  assert.throws(() => automationInstallArguments({
    templateKey: "cross_system_event_sync",
    name: "Invalid self-sync",
    parameters: {
      webhook: "stripe-events",
      source_connection: "quickbooks",
      destination_connection: "quickbooks",
      operation: "create_invoice"
    }
  }, {
    catalog,
    connections: [{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "quickbooks",
      usable: true
    }],
    contracts: operations.contracts
  }), /different connected systems/i);
});

test("Desktop retains activation authority internally while exposing a credential-free preview", () => {
  const installation = normalizeAutomationInstallation({
    installed: true,
    catalog_version: 1,
    automation: {
      id: "automation-1",
      name: "Stripe invoices into QuickBooks",
      status: "draft"
    },
    receipt_id: "receipt-1",
    activation: {
      required: true,
      tool: "set_automation",
      arguments: {
        name: "Stripe invoices into QuickBooks",
        status: "active",
        trigger: { kind: "webhook", webhook: "stripe.invoice.created" },
        steps: [{ action: "run_tool", verb: "connection_operation_call" }]
      }
    }
  });
  const visible = publicAutomationInstallation(installation);

  assert.equal(visible.activation.arguments, undefined);
  assert.equal(visible.activation.preview.trigger.kind, "webhook");
  assert.equal(installation.activation.arguments.status, "active");
});

test("the Operator tool opens setup with the user's exact intent", async () => {
  let received;
  const tool = createAutomationSetupTool({
    async begin(input) {
      received = input;
      return { ok: true, setup_id: "setup-1" };
    }
  });

  const result = await tool.handler({
    intent: "When Stripe creates an invoice, create it in QuickBooks.",
    template_key: "cross_system_event_sync",
    source_provider: "stripe",
    destination_provider: "quickbooks",
    trigger_event: "invoice.finalized",
    operation_key: "create_invoice"
  });

  assert.deepEqual(received, {
    intent: "When Stripe creates an invoice, create it in QuickBooks.",
    templateKey: "cross_system_event_sync",
    sourceProvider: "stripe",
    destinationProvider: "quickbooks",
    triggerEvent: "invoice.finalized",
    operationKey: "create_invoice"
  });
  assert.equal(result.setup_id, "setup-1");
});

test("Desktop infers the cross-system template, connection roles, and missing-contract boundary", async () => {
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-cross-system-setup",
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    openBrowser() {},
    emit() {}
  });
  controller.automationTemplates = normalizeAutomationTemplateCatalog(catalogPayload);
  controller.connectionsCatalog = {
    connections: [{
      id: "stripe-legacy",
      provider: "stripe",
      displayName: "AMOS Labs Stripe (live)",
      usable: true,
      status: "connected",
      createdAt: "2026-01-01T00:00:00.000Z"
    }, {
      id: "stripe-platform",
      provider: "stripe",
      displayName: "AMOS Labs Stripe (platform account, connection_call-ready)",
      usable: true,
      status: "connected",
      createdAt: "2026-08-01T00:00:00.000Z"
    }, {
      id: "quickbooks-live",
      provider: "quickbooks",
      displayName: "QuickBooks",
      usable: true,
      status: "connected"
    }]
  };
  controller.personalRemote = async () => ({
    async automationOperations(connection) {
      assert.equal(connection, "quickbooks-live");
      return { connectionId: connection, provider: "quickbooks", contracts: [] };
    }
  });
  controller.sendRemoteState = async () => {};

  const result = await controller.beginAutomationSetup({
    intent: "Create QuickBooks invoices from finalized Stripe invoices.",
    sourceProvider: "stripe",
    destinationProvider: "quickbooks",
    triggerEvent: "invoice.finalized"
  });

  assert.equal(result.selected_template, "cross_system_event_sync");
  assert.equal(result.source_connection, "stripe-platform");
  assert.equal(result.destination_connection, "quickbooks-live");
  assert.equal(result.conversation_required, true);
  assert.match(result.message, /continue in chat/i);
});

test("activation reuses the exact server-returned contract instead of renderer arguments", async () => {
  const catalog = normalizeAutomationTemplateCatalog(catalogPayload);
  const operations = normalizeAutomationOperations(operationPayload);
  const events = [];
  let activatedWith;
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-automation-setup",
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    openBrowser() {},
    emit(channel, payload) { events.push({ channel, payload }); }
  });
  controller.automationTemplates = catalog;
  controller.connectionsCatalog = {
    connections: [{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "quickbooks",
      usable: true,
      status: "connected"
    }]
  };
  controller.automationSetup = {
    id: "setup-1",
    intent: "Create QuickBooks invoices from Stripe events",
    templateKey: "event_driven_system_sync",
    phase: "preview",
    taskId: "task-1",
    createdAt: "2026-08-11T10:00:00.000Z"
  };
  const exactActivation = {
    name: "Stripe invoices into QuickBooks",
    status: "active",
    trigger: { kind: "webhook", webhook: "stripe.invoice.created" },
    steps: [{ action: "run_tool", verb: "connection_operation_call", _amos_contract_id: "server-pin" }]
  };
  const installation = normalizeAutomationInstallation({
    installed: true,
    automation: { id: "automation-1", name: exactActivation.name, status: "draft" },
    receipt_id: "receipt-1",
    activation: { required: true, tool: "set_automation", arguments: exactActivation }
  });
  const remote = {
    async automationOperations() { return operations; },
    async installAutomationTemplate() { return installation; },
    async automationsLibrary() { return { supported: true, automations: [] }; },
    async activateAutomationDraft(args) {
      activatedWith = args;
      return { status: "pending_approval", operation_id: "approval-1" };
    },
    async approvals() {
      return { available: true, decision_mode: "desktop", pending_operations: [] };
    }
  };
  controller.personalRemote = async () => remote;
  controller.sendRemoteState = async () => {};

  const installed = await controller.installAutomationSetup({
    setupId: "setup-1",
    templateKey: "event_driven_system_sync",
    name: exactActivation.name,
    parameters: {
      webhook: "stripe.invoice.created",
      connection: "quickbooks",
      operation: "create_invoice",
      arguments: { body: { customer_id: { $ref: "trigger.payload.customer.id" } } }
    },
    activation: { arguments: { status: "archived" } }
  });
  installed.installation.activation.preview.steps[0]._amos_contract_id = "renderer-tamper";
  const activation = await controller.activateAutomationSetup("setup-1");

  assert.deepEqual(activatedWith, exactActivation);
  assert.equal(activation.activation.pendingApproval, true);
  assert.equal(controller.activity.at(-1).detail.status, "pending_approval");
  assert.ok(events.some((event) => event.channel === "activity:changed"));
});
