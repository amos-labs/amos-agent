import { AmosMcpClient, extractMcpText, normalizeMcpToolResult } from "../mcp/amosMcpClient.js";
import { fetchCompat } from "../util/fetchCompat.js";
import {
  DEFAULT_COMPANY_CACHE_TTL_SECONDS,
  MAX_COMPANY_CACHE_TTL_SECONDS,
  MIN_COMPANY_CACHE_TTL_SECONDS,
  verifyCompanyCacheGrant
} from "./companyCache.js";
import { createAbortError, linkAbortSignal } from "../util/abort.js";
import {
  emptyNotificationPreferences,
  normalizeMissionNotificationChoice,
  normalizeMissionNotificationDelivery,
  normalizeNotificationPreferences,
  notificationPreferenceArgs
} from "./missionNotifications.js";
import {
  emptyRelationshipProfile,
  normalizeRelationshipProfile
} from "./relationshipProfile.js";
import { normalizeSharedContinuityManifest } from "./sessionContinuity.js";
import {
  emptyAutomationTemplateCatalog,
  normalizeAutomationInstallation,
  normalizeAutomationOperations,
  normalizeAutomationTemplateCatalog
} from "./automationSetup.js";
import { toPlatformEvidenceItem } from "./localReceiptStore.js";

export class DesktopRemoteStateClient {
  constructor({ mcpUrl, oauth, requestTimeoutMs = 30_000 }, fetchImpl = fetchCompat) {
    this.mcpUrl = mcpUrl;
    this.oauth = oauth;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetch = fetchImpl;
    this.mcp = new AmosMcpClient(
      {
        url: mcpUrl,
        getAccessToken: (options) => oauth.getAccessToken(options),
        requestTimeoutMs
      },
      fetchImpl
    );
  }

  async callCompanyTool(name, args = {}, options = {}) {
    try {
      return await this.mcp.callTool(name, args, options);
    } catch (error) {
      if (!isUnknownTool(error, name)) throw error;
      try {
        return await this.mcp.callTool("call_engine_tool", {
          engine: "company",
          tool: name,
          arguments: args
        }, options);
      } catch (fallbackError) {
        if (
          isUnknownTool(fallbackError, "call_engine_tool") ||
          isUnknownTool(fallbackError, name)
        ) {
          throw error;
        }
        throw fallbackError;
      }
    }
  }

  async identity({ signal = null } = {}) {
    const result = await this.mcp.callTool("whoami", {}, { signal });
    return parseMcpJson(result, "AMOS identity");
  }

  async companySnapshot({ signal = null } = {}) {
    const snapshot = parseMcpJson(
      await this.mcp.callTool("resume_company", {}, { signal }),
      "AMOS company briefing"
    );
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("AMOS company briefing returned an invalid response");
    }
    const current = { ...snapshot };
    delete current.offline_cache;
    return current;
  }

  async briefingsLibrary({ signal = null } = {}) {
    try {
      const [templatesResult, definitionsResult] = await Promise.all([
        this.mcp.callTool("list_briefing_templates", {}, { signal }),
        this.mcp.callTool("list_briefings", {}, { signal })
      ]);
      const templates = parseMcpJson(templatesResult, "AMOS Briefing templates");
      const definitions = parseMcpJson(definitionsResult, "AMOS Briefings");
      return {
        supported: true,
        contractVersion: Number(
          definitions?.contract_version || templates?.contract_version || 1
        ),
        templates: Array.isArray(templates?.templates) ? templates.templates : [],
        briefings: Array.isArray(definitions?.briefings) ? definitions.briefings : []
      };
    } catch (error) {
      if (
        isUnknownTool(error, "list_briefing_templates") ||
        isUnknownTool(error, "list_briefings")
      ) {
        return { supported: false, contractVersion: 0, templates: [], briefings: [] };
      }
      throw error;
    }
  }

  async automationsLibrary({ signal = null } = {}) {
    const [automationsResult, grantsResult, failuresResult, runsResult] = await Promise.allSettled([
      this.mcp.callTool("list_automations", {}, { signal }),
      this.mcp.callTool("list_automation_grants", {}, { signal }),
      this.mcp.callTool("list_automation_failures", { limit: 100 }, { signal }),
      this.mcp.callTool("list_automation_runs", { limit: 100 }, { signal })
    ]);
    if (automationsResult.status === "rejected") {
      if (isUnknownTool(automationsResult.reason, "list_automations")) {
        return emptyAutomationsLibrary();
      }
      throw automationsResult.reason;
    }
    const payload = parseMcpJson(automationsResult.value, "AMOS Automations");
    const grantsPayload = optionalAutomationPayload(
      grantsResult,
      "list_automation_grants",
      "AMOS Automation standing grants"
    );
    const failuresPayload = optionalAutomationPayload(
      failuresResult,
      "list_automation_failures",
      "AMOS Automation failures"
    );
    const runsPayload = optionalAutomationPayload(
      runsResult,
      "list_automation_runs",
      "AMOS Automation runs"
    );
    return {
      supported: true,
      automations: Array.isArray(payload?.automations)
        ? payload.automations.map(normalizeAutomation).filter(Boolean)
        : [],
      grantsSupported: Array.isArray(grantsPayload?.standing_grants),
      grants: Array.isArray(grantsPayload?.standing_grants)
        ? grantsPayload.standing_grants.map(normalizeAutomationGrant).filter(Boolean)
        : [],
      operationsSupported: Boolean(failuresPayload && runsPayload),
      failures: Array.isArray(failuresPayload?.items)
        ? failuresPayload.items.map(normalizeAutomationFailure).filter(Boolean)
        : [],
      runs: Array.isArray(runsPayload?.runs)
        ? runsPayload.runs.map(normalizeAutomationRun).filter(Boolean)
        : [],
      operationsContract: boundedJsonValue(
        failuresPayload?.contract || runsPayload?.contract || {}
      )
    };
  }

  async automationTemplateCatalog({ signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("list_automation_templates", {}, { signal });
      return normalizeAutomationTemplateCatalog(
        parseMcpJson(result, "AMOS Automation templates")
      );
    } catch (error) {
      if (isUnknownTool(error, "list_automation_templates")) {
        return emptyAutomationTemplateCatalog();
      }
      throw error;
    }
  }

  async automationOperations(connection, { signal = null } = {}) {
    const selected = requiredText(connection, 128, "Connection");
    const result = await this.mcp.callTool(
      "list_connection_operations",
      { connection: selected },
      { signal }
    );
    return normalizeAutomationOperations(
      parseMcpJson(result, "AMOS connection operations"),
      selected
    );
  }

  async installAutomationTemplate(args, { signal = null } = {}) {
    const result = await this.mcp.callTool("install_automation_template", args, { signal });
    return normalizeAutomationInstallation(
      parseMcpJson(result, "AMOS Automation template installation")
    );
  }

  async activateAutomationDraft(argumentsValue, { signal = null } = {}) {
    const result = await this.mcp.callTool("set_automation", argumentsValue, { signal });
    return parseMcpJson(result, "AMOS Automation activation");
  }

  async setAutomationStatus(name, active, { signal = null } = {}) {
    const automationName = requiredText(name, 200, "Automation");
    const result = await this.mcp.callTool(
      active ? "resume_automation" : "pause_automation",
      { name: automationName },
      { signal }
    );
    return parseMcpJson(
      result,
      active ? "AMOS Automation resume" : "AMOS Automation pause"
    );
  }

  async revokeAutomationGrant(grantId, reason = "", { signal = null } = {}) {
    const result = await this.mcp.callTool(
      "revoke_automation_grant",
      {
        grant_id: requiredUuid(grantId, "Automation standing grant"),
        ...(String(reason || "").trim() ? { reason: String(reason).trim().slice(0, 500) } : {})
      },
      { signal }
    );
    return parseMcpJson(result, "AMOS Automation standing grant revocation");
  }

  async simulateAutomation(automationId, sampleTrigger = null, { signal = null } = {}) {
    const args = { automation_id: requiredUuid(automationId, "Automation") };
    if (sampleTrigger !== null && sampleTrigger !== undefined) {
      if (!sampleTrigger || typeof sampleTrigger !== "object" || Array.isArray(sampleTrigger)) {
        throw new Error("Automation simulation needs a JSON object as its sample trigger");
      }
      args.sample_trigger = sampleTrigger;
    } else {
      args.historical_runs = 5;
    }
    const result = await this.mcp.callTool("simulate_automation", args, { signal });
    return parseMcpJson(result, "AMOS Automation simulation");
  }

  async repairAutomationFailure(incidentId, input = {}, { signal = null } = {}) {
    const action = String(input.action || "");
    if (!["retry", "settle_applied", "dismiss"].includes(action)) {
      throw new Error("Choose a valid Automation failure resolution");
    }
    const note = requiredText(input.note, 1_000, "Repair note");
    const effectState = String(input.externalEffectState || "unknown");
    if (!["unknown", "not_applied", "applied"].includes(effectState)) {
      throw new Error("Choose whether the external effect was applied");
    }
    const result = input.result && typeof input.result === "object" && !Array.isArray(input.result)
      ? input.result
      : {};
    const response = await this.mcp.callTool(
      "repair_automation_failure",
      {
        incident_id: requiredUuid(incidentId, "Automation failure"),
        action,
        external_effect_state: effectState,
        result,
        note
      },
      { signal }
    );
    return parseMcpJson(response, "AMOS Automation failure repair");
  }

  async runBriefing(input, { signal = null } = {}) {
    const result = await this.mcp.callTool("run_briefing", briefingRunArgs(input), { signal });
    return parseMcpJson(result, "AMOS Briefing run");
  }

  async briefingRun(runId, { signal = null } = {}) {
    const result = await this.mcp.callTool(
      "get_briefing_run",
      { run_id: requiredUuid(runId, "Briefing run") },
      { signal }
    );
    return parseMcpJson(result, "AMOS Briefing run");
  }

  async createBriefing(input, { signal = null } = {}) {
    const result = await this.mcp.callTool("create_briefing", briefingDefinitionArgs(input), {
      signal
    });
    return parseMcpJson(result, "AMOS saved Briefing");
  }

  async archiveBriefing(briefingId, { signal = null } = {}) {
    const result = await this.mcp.callTool(
      "archive_briefing",
      { briefing_id: requiredUuid(briefingId, "Briefing") },
      { signal }
    );
    return parseMcpJson(result, "AMOS archived Briefing");
  }

  async scheduleBriefing(briefingId, cadence, { signal = null } = {}) {
    const result = await this.mcp.callTool(
      "schedule_briefing",
      {
        briefing_id: requiredUuid(briefingId, "Briefing"),
        cadence: normalizeBriefingCadence(cadence)
      },
      { signal }
    );
    return parseMcpJson(result, "AMOS Briefing schedule");
  }

  async setBriefingScheduleStatus(scheduleId, active, { signal = null } = {}) {
    const result = await this.mcp.callTool(
      active ? "resume_briefing_schedule" : "pause_briefing_schedule",
      { schedule_id: requiredUuid(scheduleId, "Schedule") },
      { signal }
    );
    return parseMcpJson(result, "AMOS Briefing schedule status");
  }

  async receipts({ limit = 50, signal = null } = {}) {
    return (await this.receiptWindow({ limit, signal })).display;
  }

  async receiptWindow({ limit = 50, signal = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
      const result = await this.mcp.callTool(
        "list_receipts",
        { limit: boundedLimit },
        { signal }
      );
      const payload = parseMcpJson(result, "AMOS proof receipts");
      const rows = Array.isArray(payload?.receipts) ? payload.receipts : [];
      return {
        display: rows.map(normalizeReceipt).filter(Boolean),
        platform: rows.map(toPlatformEvidenceItem).filter(Boolean).slice(0, 200)
      };
    } catch (error) {
      if (isUnknownTool(error, "list_receipts")) return { display: [], platform: [] };
      throw error;
    }
  }

  async hydrateContinuity({ contextKey = null, tenantId = "", signal = null } = {}) {
    const args = contextKey ? { context_key: String(contextKey) } : {};
    try {
      const result = await this.mcp.callTool("hydrate_context", args, { signal });
      return normalizeContinuityResponse(
        parseMcpJson(result, "AMOS working continuity"),
        { tenantId }
      );
    } catch (error) {
      if (isUnknownTool(error, "hydrate_context")) {
        return {
          supported: false,
          available: false,
          contextKey: contextKey || "active",
          revision: 0,
          sourceClient: "",
          updatedAt: null,
          stale: false,
          manifest: null
        };
      }
      throw error;
    }
  }

  async captureContinuity(input, { tenantId = "", signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("capture_context", input, { signal });
      return normalizeContinuityResponse(
        parseMcpJson(result, "AMOS working continuity checkpoint"),
        { tenantId }
      );
    } catch (error) {
      if (isUnknownTool(error, "capture_context")) {
        return {
          supported: false,
          available: false,
          contextKey: String(input?.context_key || "active"),
          revision: 0,
          sourceClient: "",
          updatedAt: null,
          stale: false,
          manifest: null
        };
      }
      throw error;
    }
  }

  async clearContinuity({ contextKey = "active", tenantId = "", signal = null } = {}) {
    const args = { context_key: String(contextKey || "active") };
    try {
      const result = await this.mcp.callTool("clear_context", args, { signal });
      return normalizeContinuityResponse(
        parseMcpJson(result, "AMOS working continuity clear"),
        { tenantId }
      );
    } catch (error) {
      if (isUnknownTool(error, "clear_context")) {
        return {
          supported: false,
          available: false,
          cleared: false,
          contextKey: args.context_key,
          revision: 0,
          sourceClient: "",
          updatedAt: null,
          stale: false,
          manifest: null
        };
      }
      throw error;
    }
  }

  async getCollaborationProfile({ signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("get_collaboration_profile", {}, { signal });
      return normalizeCollaborationProfileResponse(
        parseMcpJson(result, "AMOS collaboration profile")
      );
    } catch (error) {
      if (isUnknownTool(error, "get_collaboration_profile")) {
        return unsupportedCollaborationProfile();
      }
      throw error;
    }
  }

  async updateCollaborationProfile(input, { signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("update_collaboration_profile", {
        expected_revision: Number(input?.expected_revision),
        profile: {
          explicitPreferences: Array.isArray(input?.profile?.explicitPreferences)
            ? input.profile.explicitPreferences
            : []
        }
      }, { signal });
      return normalizeCollaborationProfileResponse(
        parseMcpJson(result, "AMOS collaboration profile update")
      );
    } catch (error) {
      if (isUnknownTool(error, "update_collaboration_profile")) {
        throw new Error("This AMOS company does not yet store collaboration preferences");
      }
      throw error;
    }
  }

  async resetCollaborationProfile({ expectedRevision = 0, signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("reset_collaboration_profile", {
        expected_revision: Number(expectedRevision)
      }, { signal });
      return normalizeCollaborationProfileResponse(
        parseMcpJson(result, "AMOS collaboration profile reset")
      );
    } catch (error) {
      if (isUnknownTool(error, "reset_collaboration_profile")) {
        throw new Error("This AMOS company does not yet store collaboration preferences");
      }
      throw error;
    }
  }

  async tasksLibrary({ includeArchived = false, query = "", signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("list_tasks", {
        include_archived: includeArchived === true,
        query: String(query || "").slice(0, 160),
        limit: 100
      }, { signal });
      const payload = parseMcpJson(result, "AMOS Tasks");
      return {
        supported: true,
        tasks: (Array.isArray(payload?.tasks) ? payload.tasks : [])
          .map(normalizeTaskResource)
          .filter(Boolean),
        contract: payload?.contract && typeof payload.contract === "object"
          ? payload.contract
          : null
      };
    } catch (error) {
      if (isUnknownTool(error, "list_tasks")) {
        return { supported: false, tasks: [], contract: null };
      }
      throw error;
    }
  }

  async projectsLibrary({ includeArchived = true, includeTerminal = true, signal = null } = {}) {
    let projectsResult;
    try {
      projectsResult = await this.callCompanyTool("list_projects", {
        include_archived: includeArchived === true,
        limit: 100
      }, { signal });
    } catch (error) {
      if (isUnknownTool(error, "list_projects")) {
        return emptyProjectsLibrary();
      }
      throw error;
    }
    const projectsPayload = parseMcpJson(projectsResult, "AMOS Projects");
    let inbox = [];
    let stalledCount = 0;
    let runContract = null;
    try {
      const inboxResult = await this.callCompanyTool("list_task_inbox", {
        include_terminal: includeTerminal === true,
        limit: 200
      }, { signal });
      const inboxPayload = parseMcpJson(inboxResult, "AMOS task inbox");
      inbox = (Array.isArray(inboxPayload?.items) ? inboxPayload.items : [])
        .map(normalizeTaskRun)
        .filter(Boolean);
      stalledCount = boundedCount(inboxPayload?.stalled_count);
      runContract = boundedContract(inboxPayload?.contract);
    } catch (error) {
      if (!isUnknownTool(error, "list_task_inbox")) throw error;
    }
    return {
      supported: true,
      projects: (Array.isArray(projectsPayload?.projects) ? projectsPayload.projects : [])
        .map(normalizeProject)
        .filter(Boolean),
      inbox,
      stalledCount,
      projectContract: boundedContract(projectsPayload?.contract),
      runContract
    };
  }

  async missionsLibrary({ signal = null } = {}) {
    const [missionsResult, goalsResult, templatesResult] = await Promise.allSettled([
      this.mcp.callTool("list_missions", {}, { signal }),
      this.mcp.callTool("list_goals", {}, { signal }),
      this.mcp.callTool("list_mission_templates", {}, { signal })
    ]);
    const missionUnknown = missionsResult.status === "rejected" &&
      isUnknownTool(missionsResult.reason, "list_missions");
    const goalsUnknown = goalsResult.status === "rejected" &&
      isUnknownTool(goalsResult.reason, "list_goals");
    const templatesUnknown = templatesResult.status === "rejected" &&
      isUnknownTool(templatesResult.reason, "list_mission_templates");
    if (missionsResult.status === "rejected" && !missionUnknown) throw missionsResult.reason;
    if (goalsResult.status === "rejected" && !goalsUnknown) throw goalsResult.reason;
    if (templatesResult.status === "rejected" && !templatesUnknown) throw templatesResult.reason;

    const missionsPayload = missionsResult.status === "fulfilled"
      ? parseMcpJson(missionsResult.value, "AMOS Missions")
      : null;
    const goalsPayload = goalsResult.status === "fulfilled"
      ? parseMcpJson(goalsResult.value, "AMOS Optimization Missions")
      : null;
    const templatesPayload = templatesResult.status === "fulfilled"
      ? parseMcpJson(templatesResult.value, "AMOS Mission templates")
      : null;
    const missions = (Array.isArray(missionsPayload?.missions) ? missionsPayload.missions : [])
      .map(normalizeMission)
      .filter(Boolean);
    const optimizationMissions = (Array.isArray(goalsPayload?.goals) ? goalsPayload.goals : [])
      .map(normalizeOptimizationMission)
      .filter(Boolean);
    const templates = (Array.isArray(templatesPayload?.templates) ? templatesPayload.templates : [])
      .map(normalizeMissionTemplate)
      .filter(Boolean);
    return {
      supported: missionsResult.status === "fulfilled" || goalsResult.status === "fulfilled",
      missions,
      optimizationMissions,
      templates,
      count: missions.length + optimizationMissions.length,
      scheduler: goalsPayload ? {
        enabled: goalsPayload.loop_enabled === true,
        masterEnabled: goalsPayload.master_enabled === true,
        executionEnabled: goalsPayload.execution_enabled === true,
        state: String(goalsPayload.state || "").slice(0, 80),
        stateDetail: String(goalsPayload.state_detail || "").slice(0, 1_000)
      } : null
    };
  }

  /** Compile a Run Contract without creating anything (create_mission dry_run). */
  async compileMission(spec, { signal = null } = {}) {
    const args = { ...missionSpecArgs(spec), dry_run: true };
    return normalizeMcpToolResult(await this.callCompanyTool("create_mission", args, { signal }));
  }

  /** The one deliberate create_mission call; the token confirms a budget AMOS guessed. */
  async createMission(spec, confirmationToken = "", { signal = null } = {}) {
    const args = missionSpecArgs(spec);
    const token = String(confirmationToken || "").trim();
    if (token) args.confirmation_token = token;
    return normalizeMcpToolResult(await this.callCompanyTool("create_mission", args, { signal }));
  }

  async mission(id, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool(
        "get_mission",
        { mission_id: requiredUuid(id, "Mission") },
        { signal }
      ),
      "AMOS Mission"
    );
    const mission = normalizeMission(payload);
    if (!mission) throw new Error("AMOS Mission returned an invalid response");
    return mission;
  }

  // ---- Mission notification channels (platform PR #727 and the per-Mission channel contract) ----

  /** This user's saved defaults; a server without the verb reports "not configured" for everything. */
  async getNotificationPreferences({ signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("get_notification_preferences", {}, { signal });
      return normalizeNotificationPreferences(parseMcpJson(result, "AMOS notification preferences"));
    } catch (error) {
      if (isUnknownTool(error, "get_notification_preferences")) {
        return { ...emptyNotificationPreferences(), available: false, supported: false };
      }
      throw error;
    }
  }

  /**
   * set_notification_preferences. A new sms_number is stored unverified and texted a code; the
   * returned `verification` says whether a code is pending, already verified, or cleared.
   */
  async setNotificationPreferences(input, { signal = null } = {}) {
    const args = notificationPreferenceArgs(input);
    if (Object.keys(args).length === 0) throw new Error("Nothing to change in notification preferences");
    try {
      const payload = parseMcpJson(
        await this.mcp.callTool("set_notification_preferences", args, { signal }),
        "AMOS notification preferences"
      );
      return {
        preferences: normalizeNotificationPreferences(payload),
        verification: payload?.verification && typeof payload.verification === "object"
          ? boundedJsonValue(payload.verification)
          : null
      };
    } catch (error) {
      if (isUnknownTool(error, "set_notification_preferences")) {
        throw new Error("This AMOS company does not yet store notification preferences");
      }
      throw error;
    }
  }

  /** verify_notification_phone with the 6-digit code the user was texted. */
  async verifyNotificationPhone(code, { signal = null } = {}) {
    const digits = String(code || "").replaceAll(/\s+/g, "");
    if (!/^\d{6}$/.test(digits)) throw new Error("Enter the 6-digit code you were texted");
    try {
      const payload = parseMcpJson(
        await this.mcp.callTool("verify_notification_phone", { code: digits }, { signal }),
        "AMOS phone verification"
      );
      return {
        verified: payload?.verified === true,
        preferences: normalizeNotificationPreferences(payload)
      };
    } catch (error) {
      if (isUnknownTool(error, "verify_notification_phone")) {
        throw new Error("This AMOS company does not yet verify notification phone numbers");
      }
      throw error;
    }
  }

  /** list_mission_notifications: every outbox row for one Mission with status, delivered_at, last_error. */
  async missionNotifications(id, { signal = null } = {}) {
    try {
      const payload = parseMcpJson(
        await this.mcp.callTool(
          "list_mission_notifications",
          { mission_id: requiredUuid(id, "Mission") },
          { signal }
        ),
        "AMOS Mission notifications"
      );
      return {
        supported: true,
        missionId: validUuidOrEmpty(payload?.mission_id) || String(id),
        delivery: normalizeMissionNotificationDelivery(payload?.notification_delivery)
      };
    } catch (error) {
      if (isUnknownTool(error, "list_mission_notifications")) {
        return { supported: false, missionId: String(id), delivery: [] };
      }
      throw error;
    }
  }

  /**
   * set_mission_notification_channels(mission_id, notifications). The verb is being added to the
   * Platform; until it exists the error carries code "unsupported" so Desktop can say so plainly.
   */
  async setMissionNotificationChannels(id, notifications, { signal = null } = {}) {
    const choice = normalizeMissionNotificationChoice(notifications);
    if (!choice) throw new Error("Choose at least one place to send Mission updates");
    try {
      const payload = parseMcpJson(
        await this.callCompanyTool(
          "set_mission_notification_channels",
          { mission_id: requiredUuid(id, "Mission"), notifications: choice },
          { signal }
        ),
        "AMOS Mission notification channels"
      );
      return {
        missionId: validUuidOrEmpty(payload?.mission_id) || String(id),
        notifications: normalizeMissionNotificationChoice(payload?.notifications) || choice
      };
    } catch (error) {
      if (isUnknownTool(error, "set_mission_notification_channels")) {
        const unsupported = new Error("Changing a Mission's channels is not available yet on this AMOS company");
        unsupported.code = "unsupported";
        throw unsupported;
      }
      throw error;
    }
  }

  async setOptimizationMissionStatus(id, status, { signal = null } = {}) {
    const normalizedStatus = String(status || "").trim();
    if (!new Set(["active", "paused", "abandoned"]).has(normalizedStatus)) {
      throw new Error("Optimization Mission status is invalid");
    }
    return parseMcpJson(
      await this.mcp.callTool("set_goal_status", {
        goal_id: requiredUuid(id, "Optimization Mission"),
        status: normalizedStatus
      }, { signal }),
      "AMOS Optimization Mission"
    );
  }

  async pauseMission(id, reason = "", { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("pause_mission", {
        mission_id: requiredUuid(id, "Mission"),
        ...(String(reason || "").trim()
          ? { reason: String(reason).trim().slice(0, 400) }
          : {})
      }, { signal }),
      "AMOS Mission pause"
    );
    return {
      missionId: validUuidOrEmpty(payload?.mission_id),
      status: String(payload?.status || "paused").slice(0, 40)
    };
  }

  async cancelMission(id, reason = "", { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("cancel_mission", {
        mission_id: requiredUuid(id, "Mission"),
        ...(String(reason || "").trim()
          ? { reason: String(reason).trim().slice(0, 400) }
          : {})
      }, { signal }),
      "AMOS Mission cancellation"
    );
    return {
      missionId: validUuidOrEmpty(payload?.mission_id),
      status: String(payload?.status || "cancelled").slice(0, 40)
    };
  }

  async project(id, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool(
        "get_project",
        { project_id: requiredUuid(id, "Project") },
        { signal }
      ),
      "AMOS Project"
    );
    const project = normalizeProject(payload?.project);
    if (!project) throw new Error("AMOS Project returned an invalid response");
    return {
      project,
      tasks: (Array.isArray(payload?.tasks) ? payload.tasks : [])
        .map(normalizeTaskResource)
        .filter(Boolean),
      runs: (Array.isArray(payload?.runs) ? payload.runs : [])
        .map(normalizeTaskRun)
        .filter(Boolean),
      contract: boundedContract(payload?.contract)
    };
  }

  async createProject(input, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("create_project", projectMutationArgs(input), { signal }),
      "AMOS Project creation"
    );
    const project = normalizeProject(payload?.project);
    if (!project) throw new Error("AMOS Project creation returned an invalid response");
    return { project, contract: boundedContract(payload?.contract) };
  }

  async updateProject(id, changes, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool(
        "update_project",
        { project_id: requiredUuid(id, "Project"), ...projectMutationArgs(changes, { partial: true }) },
        { signal }
      ),
      "AMOS Project update"
    );
    const project = normalizeProject(payload?.project);
    if (!project) throw new Error("AMOS Project update returned an invalid response");
    return { project, changed: normalizeStringList(payload?.changed, 20, 80) };
  }

  async assignTaskToProject(taskId, projectId = null, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool(
        "assign_task_to_project",
        {
          task_id: requiredUuid(taskId, "Task"),
          ...(projectId ? { project_id: requiredUuid(projectId, "Project") } : {})
        },
        { signal }
      ),
      "AMOS Project task assignment"
    );
    const task = normalizeTaskResource(payload?.task);
    if (!task) throw new Error("AMOS Project task assignment returned an invalid task");
    return { task, contract: boundedContract(payload?.contract) };
  }

  async startTaskRun(input, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("start_task_run", taskRunStartArgs(input), { signal }),
      "AMOS task-run admission"
    );
    const run = normalizeTaskRun(payload?.run);
    if (!run) throw new Error("AMOS task-run admission returned an invalid run");
    return {
      run,
      accepted: payload?.accepted === true,
      idempotent: payload?.idempotent === true,
      continue: payload?.continue !== false,
      contract: boundedContract(payload?.contract)
    };
  }

  async reportTaskRun(input, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("report_task_run", taskRunReportArgs(input), { signal }),
      "AMOS task-run report"
    );
    const run = normalizeTaskRun(payload?.run);
    if (!run) throw new Error("AMOS task-run report returned an invalid run");
    return {
      run,
      accepted: payload?.accepted === true,
      continue: payload?.continue !== false,
      reason: String(payload?.reason || "").slice(0, 160),
      contract: boundedContract(payload?.contract)
    };
  }

  async cancelTaskRun(id, reason = "", { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool(
        "request_task_run_cancel",
        {
          run_id: requiredUuid(id, "Task run"),
          ...(String(reason || "").trim()
            ? { reason: String(reason).trim().slice(0, 1_000) }
            : {})
        },
        { signal }
      ),
      "AMOS task-run cancellation"
    );
    const run = normalizeTaskRun(payload?.run);
    if (!run) throw new Error("AMOS task-run cancellation returned an invalid run");
    return { run, continue: false, contract: boundedContract(payload?.contract) };
  }

  async registerTask(input, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("register_task", taskRegistrationArgs(input), { signal }),
      "AMOS task registration"
    );
    return normalizeTaskMutation(payload, "registered");
  }

  async updateTask(id, changes, { signal = null } = {}) {
    const args = { task_id: requiredUuid(id, "Task") };
    for (const [source, target] of [
      ["title", "title"],
      ["objective", "objective"],
      ["status", "status"],
      ["pinned", "pinned"],
      ["archived", "archived"]
    ]) {
      if (Object.hasOwn(changes || {}, source)) args[target] = changes[source];
    }
    const payload = parseMcpJson(
      await this.mcp.callTool("update_task", args, { signal }),
      "AMOS task update"
    );
    return normalizeTaskMutation(payload, "updated");
  }

  async forkTask(input, { signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("fork_task", taskForkArgs(input), { signal }),
      "AMOS task fork"
    );
    return normalizeTaskMutation(payload, "forked");
  }

  async resumeTask(id, { tenantId = "", signal = null } = {}) {
    const payload = parseMcpJson(
      await this.mcp.callTool("resume_task", { task_id: requiredUuid(id, "Task") }, { signal }),
      "AMOS task resume"
    );
    const task = normalizeTaskResource(payload?.task);
    if (!task) throw new Error("AMOS task resume returned an invalid task");
    return {
      task,
      continuity: normalizeContinuityResponse(payload?.continuity || {}, {
        tenantId
      }),
      events: Array.isArray(payload?.events) ? payload.events.slice(0, 30) : [],
      children: (Array.isArray(payload?.children) ? payload.children : [])
        .map(normalizeTaskResource)
        .filter(Boolean),
      resumeContract: normalizeResumeContract(payload?.resume_contract)
    };
  }

  async connectionsCatalog({ signal = null } = {}) {
    const [connectionsResult, providerPayload] = await Promise.all([
      this.mcp.callTool("list_connections", {}, { signal }),
      this.connectionProviderCatalog({ signal })
    ]);
    const connectionPayload = parseMcpJson(connectionsResult, "AMOS connections");
    const providers = Array.isArray(providerPayload?.providers)
      ? providerPayload.providers.map(normalizeProvider).filter(Boolean)
      : [
          ...(Array.isArray(providerPayload?.curated) ? providerPayload.curated : []),
          ...(Array.isArray(providerPayload?.tenant_defined) ? providerPayload.tenant_defined : [])
        ].map(normalizeProvider).filter(Boolean);
    return {
      connections: Array.isArray(connectionPayload?.connections)
        ? connectionPayload.connections.map(normalizeConnection).filter(Boolean)
        : [],
      providers,
      catalogVersion: Number(providerPayload?.catalog_version || 0),
      // Retained for one release so older renderer consumers do not break while
      // list_connection_catalog rolls through deployed platform environments.
      curated: Array.isArray(providerPayload?.curated)
        ? providerPayload.curated.map(normalizeProvider).filter(Boolean)
        : [],
      tenantDefined: Array.isArray(providerPayload?.tenant_defined)
        ? providerPayload.tenant_defined.map(normalizeProvider).filter(Boolean)
        : []
    };
  }

  async disconnectConnection(connectionId, { signal = null } = {}) {
    const result = await this.mcp.callTool(
      "delete_connection",
      { connection_id: requiredUuid(connectionId, "Connection") },
      { signal }
    );
    return parseMcpJson(result, "AMOS connection disconnect");
  }

  async connectionProviderCatalog({ signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("list_connection_catalog", {}, { signal });
      return parseMcpJson(result, "AMOS connection catalog");
    } catch (error) {
      if (!/unknown tool ['"]list_connection_catalog['"]/i.test(String(error?.message || ""))) {
        throw error;
      }
      // Backward-compatible rollout only. The legacy response remains
      // platform-owned; Desktop never substitutes a bundled provider list.
      const result = await this.mcp.callTool("list_oauth_providers", {}, { signal });
      return parseMcpJson(result, "AMOS connection providers");
    }
  }

  async connectLink(provider, { signal = null } = {}) {
    const providerKey = String(provider || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(providerKey)) {
      throw new Error("AMOS blocked an invalid connection provider");
    }
    const result = await this.mcp.callTool(
      "connect_link",
      { provider: providerKey },
      { signal }
    );
    const payload = parseMcpJson(result, "AMOS connection link");
    const url = String(payload?.url || "");
    if (!url) throw new Error("AMOS did not return a connection link");
    return {
      provider: String(payload?.provider || providerKey),
      url,
      expiresIn: Number(payload?.expires_in || 0)
    };
  }

  async createSecretConnection(input, { signal = null } = {}) {
    const provider = String(input?.provider || "").trim();
    const displayName = String(input?.displayName || "").trim();
    const credential = String(input?.credential || "");
    const username = String(input?.username || "").trim();
    const defaultFrom = String(input?.defaultFrom || "").trim();
    const authScheme = String(input?.authScheme || "bearer");
    const baseUrl = String(input?.baseUrl || "").trim();

    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider)) {
      throw new Error("AMOS blocked an invalid connection provider");
    }
    if (!displayName || displayName.length > 120) {
      throw new Error("Connection name must be between 1 and 120 characters");
    }
    if (!credential || credential.length > 16_384) {
      throw new Error("Credential must be between 1 and 16,384 characters");
    }
    if (!["bearer", "basic", "api_key"].includes(authScheme)) {
      throw new Error("AMOS blocked an unsupported credential shape");
    }
    if (authScheme === "basic" && !username) {
      throw new Error("This connection requires a username or account identifier");
    }
    if (baseUrl) {
      let parsedBaseUrl;
      try {
        parsedBaseUrl = new URL(baseUrl);
      } catch {
        throw new Error("Connection API root must be a valid HTTPS URL");
      }
      if (parsedBaseUrl.protocol !== "https:") {
        throw new Error("Connection API root must use HTTPS");
      }
    }

    const args = {
      provider,
      display_name: displayName,
      base_url: baseUrl || undefined,
      config: defaultFrom ? { default_from: defaultFrom } : {},
      service_account: input?.serviceAccount === true
    };
    if (authScheme === "basic") {
      args.secrets = { username, password: credential };
      args.auth_shape = {
        scheme: "basic",
        username_secret: "username",
        password_secret: "password"
      };
    } else {
      args.credential = credential;
      args.auth_shape = {
        scheme: authScheme,
        secret: "credential",
        ...(authScheme === "api_key"
          ? { name: "X-API-Key", placement: "header" }
          : {})
      };
    }

    const result = await this.mcp.callTool("create_connection", args, { signal });
    const payload = parseMcpJson(result, "AMOS connection setup");
    if (payload?.connected !== true) {
      throw new Error("AMOS did not confirm that the connection was saved");
    }
    return {
      connected: true,
      provider: String(payload.provider || provider),
      displayName: String(payload.display_name || displayName),
      connectionId: String(payload.connection_id || "")
    };
  }

  async connectNuvolaLearning(input, { signal = null } = {}) {
    const displayName = String(input?.displayName || "Nuvola Learning").trim();
    const credential = String(input?.credential || "");
    const corporationId = Number(input?.corporationId);
    if (!displayName || displayName.length > 120) {
      throw new Error("Connection name must be between 1 and 120 characters");
    }
    if (!credential || credential.length > 4096) {
      throw new Error("Credential must be between 1 and 4,096 characters");
    }
    if (!Number.isSafeInteger(corporationId) || corporationId < 1) {
      throw new Error("Nuvola corporation ID must be a positive number");
    }
    const result = await this.mcp.callTool(
      "connect_nuvola_learning",
      {
        display_name: displayName,
        credential,
        corporation_id: corporationId
      },
      { signal }
    );
    const payload = parseMcpJson(result, "AMOS Nuvola connection setup");
    if (payload?.connected !== true) {
      throw new Error("AMOS did not confirm that the Nuvola connection was saved");
    }
    return {
      connected: true,
      provider: String(payload.provider || "nuvola_learning_mcp"),
      displayName: String(payload.display_name || displayName),
      connectionId: String(payload.connection_id || "")
    };
  }

  async approvals({ signal = null } = {}) {
    let token = await this.oauth.getAccessToken();
    let response = await this.fetchApprovals(token, { signal });
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchApprovals(token, { signal });
    }

    const payload = await parseJsonResponse(response, "AMOS approvals");
    if (response.status === 403) {
      return {
        available: false,
        reason: payload.error || "Only an owner or admin can review company approvals.",
        decision_mode: "hosted",
        pending_operations: [],
        mission_decisions: []
      };
    }
    if (!response.ok) {
      throw new Error(payload.error || `AMOS approvals request failed with ${response.status}`);
    }
    return {
      available: true,
      reason: "",
      decision_mode: payload.decision_mode === "desktop" ? "desktop" : "hosted",
      pending_operations: Array.isArray(payload.pending_operations)
        ? payload.pending_operations.map(normalizeApproval).filter(Boolean)
        : [],
      mission_decisions: Array.isArray(payload.mission_decisions)
        ? payload.mission_decisions.map(normalizeMissionDecision).filter(Boolean)
        : []
    };
  }

  async decideApproval(id, decision, { signal = null, sign = null } = {}) {
    const approvalId = String(id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new Error("Invalid AMOS approval id");
    const action = decision === "approve" ? "approve" : decision === "deny" ? "deny" : null;
    if (!action) throw new Error("Approval decision must be approve or deny");
    if (typeof sign !== "function") throw new Error("Desktop approval signing is unavailable");
    let token = await this.oauth.getAccessToken();
    let challengeResponse = await this.fetchApprovalChallenge(token, approvalId, action, { signal });
    if (challengeResponse.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      challengeResponse = await this.fetchApprovalChallenge(token, approvalId, action, { signal });
    }
    const challenge = await parseJsonResponse(challengeResponse, "AMOS approval challenge");
    if (!challengeResponse.ok) {
      throw new Error(challenge.error || `AMOS approval challenge failed with ${challengeResponse.status}`);
    }
    if (
      !/^[0-9a-f-]{36}$/i.test(challenge.challenge_id || "") ||
      typeof challenge.message !== "string"
    ) {
      throw new Error("AMOS returned an invalid approval challenge");
    }
    const signature = await sign(challenge.message);
    let response = await this.fetchApprovalDecision(
      token,
      approvalId,
      action,
      { challengeId: challenge.challenge_id, signature, signal }
    );
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchApprovalDecision(
        token,
        approvalId,
        action,
        { challengeId: challenge.challenge_id, signature, signal }
      );
    }
    const payload = await parseJsonResponse(response, `AMOS approval ${action}`);
    if (!response.ok) {
      throw new Error(payload.error || `AMOS approval ${action} failed with ${response.status}`);
    }
    return payload;
  }

  async answerMissionDecision(id, answer, { signal = null, sign = null } = {}) {
    const decisionId = String(id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(decisionId)) throw new Error("Invalid AMOS Mission decision id");
    const exactAnswer = String(answer || "").trim();
    if (!exactAnswer || exactAnswer.length > 4_000) {
      throw new Error("Mission answer must be between 1 and 4,000 characters");
    }
    if (typeof sign !== "function") throw new Error("Desktop decision signing is unavailable");
    let token = await this.oauth.getAccessToken();
    let challengeResponse = await this.fetchMissionDecisionChallenge(
      token,
      decisionId,
      exactAnswer,
      { signal }
    );
    if (challengeResponse.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      challengeResponse = await this.fetchMissionDecisionChallenge(
        token,
        decisionId,
        exactAnswer,
        { signal }
      );
    }
    const challenge = await parseJsonResponse(challengeResponse, "AMOS Mission decision challenge");
    if (!challengeResponse.ok) {
      throw new Error(
        challenge.error || `AMOS Mission decision challenge failed with ${challengeResponse.status}`
      );
    }
    if (!/^[0-9a-f-]{36}$/i.test(challenge.challenge_id || "") || typeof challenge.message !== "string") {
      throw new Error("AMOS returned an invalid Mission decision challenge");
    }
    const signature = await sign(challenge.message);
    let response = await this.fetchMissionDecisionAnswer(token, decisionId, {
      answer: exactAnswer,
      challengeId: challenge.challenge_id,
      signature,
      signal
    });
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchMissionDecisionAnswer(token, decisionId, {
        answer: exactAnswer,
        challengeId: challenge.challenge_id,
        signature,
        signal
      });
    }
    const payload = await parseJsonResponse(response, "AMOS Mission decision answer");
    if (!response.ok) {
      throw new Error(payload.error || `AMOS Mission decision answer failed with ${response.status}`);
    }
    return payload;
  }

  async intelligenceStatus({ signal = null } = {}) {
    let token = await this.oauth.getAccessToken();
    let response = await this.fetchIntelligenceStatus(token, { signal });
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchIntelligenceStatus(token, { signal });
    }

    const payload = await parseJsonResponse(response, "AMOS account status");
    if (!response.ok) {
      throw new Error(
        payload?.error?.message ||
          payload?.message ||
          `AMOS account status request failed with ${response.status}`
      );
    }
    const subscriptionStatus = String(payload?.billing?.subscription_status || "none");
    const billingExempt = payload?.billing?.billing_exempt === true;
    const demo = payload?.demo && typeof payload.demo === "object"
      ? {
          messageLimit: boundedCount(payload.demo.message_limit),
          messagesUsed: boundedCount(payload.demo.messages_used),
          messagesRemaining: boundedCount(payload.demo.messages_remaining)
        }
      : null;
    const status = {
      ready: payload?.ready === true,
      subscriptionStatus,
      billingExempt,
      includedCreditRemainingUsd:
        typeof payload?.billing?.included_credit_remaining_usd === "string"
          ? payload.billing.included_credit_remaining_usd.slice(0, 32)
          : null,
      demo,
      workspaceActive: payload?.billing?.workspace_active === true ||
        billingExempt || subscriptionStatus === "active" || subscriptionStatus === "trialing"
    };
    if (typeof payload?.billing?.access_mode === "string") {
      status.accessMode = payload.billing.access_mode.slice(0, 64);
    }
    if (payload?.billing?.free_connections_limit != null) {
      status.freeConnectionsLimit = boundedCount(payload.billing.free_connections_limit);
    }
    return status;
  }

  async companyCache({
    identity,
    ttlSeconds = DEFAULT_COMPANY_CACHE_TTL_SECONDS
  } = {}) {
    if (!identity || identity.principal_type !== "user") {
      throw new Error("A signed-in AMOS user is required to refresh company context");
    }
    const ttl = Number(ttlSeconds);
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_COMPANY_CACHE_TTL_SECONDS ||
      ttl > MAX_COMPANY_CACHE_TTL_SECONDS
    ) {
      throw new Error(
        `Company context lifetime must be between ${MIN_COMPANY_CACHE_TTL_SECONDS} and ${MAX_COMPANY_CACHE_TTL_SECONDS} seconds`
      );
    }
    const result = parseMcpJson(
      await this.mcp.callTool("resume_company", {
        issue_offline_cache: true,
        cache_ttl_seconds: ttl
      }),
      "AMOS company cache"
    );
    const metadata = result?.offline_cache;
    if (!metadata?.token) {
      throw new Error("AMOS did not issue a signed company cache");
    }
    const issuer = amosOrigin(this.mcpUrl);
    const jwks = await this.fetchJwks(issuer);
    const claims = verifyCompanyCacheGrant({
      token: metadata.token,
      jwks,
      expectedIssuer: issuer,
      expectedIdentity: identity
    });
    const snapshot = { ...result };
    delete snapshot.offline_cache;
    if (!sameJson(snapshot, claims.snapshot)) {
      throw new Error("AMOS company-cache envelope does not match its signed snapshot");
    }
    const jwk = jwks.keys.find((key) => key.kid === metadata.kid);
    if (!jwk) throw new Error("AMOS company-cache key is missing from its live JWKS");
    return {
      token: metadata.token,
      claims,
      jwk
    };
  }

  async fetchJwks(issuer = amosOrigin(this.mcpUrl)) {
    const url = new URL("/.well-known/amos-app-auth/jwks.json", issuer);
    if (url.origin !== amosOrigin(this.mcpUrl)) {
      throw new Error("AMOS company-cache keys must share the connected server origin");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const payload = await parseJsonResponse(response, "AMOS signing keys");
      if (!response.ok || !Array.isArray(payload.keys)) {
        throw new Error(
          payload.error || `AMOS signing-key request failed with ${response.status}`
        );
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("AMOS signing-key request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchApprovals(token, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(`${amosOrigin(this.mcpUrl)}/api/v1/approvals`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS approvals request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchApprovalChallenge(token, id, action, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(
        `${amosOrigin(this.mcpUrl)}/api/v1/approvals/${encodeURIComponent(id)}/challenge`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ decision: action }),
          signal: controller.signal
        }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS approval challenge timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchApprovalDecision(
    token,
    id,
    action,
    { challengeId, signature, signal = null } = {}
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(
        `${amosOrigin(this.mcpUrl)}/api/v1/approvals/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            challenge_id: challengeId,
            signature
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS approval decision timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchMissionDecisionChallenge(token, id, answer, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(
        `${amosOrigin(this.mcpUrl)}/api/v1/mission-decisions/${encodeURIComponent(id)}/challenge`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ answer }),
          signal: controller.signal
        }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS Mission decision challenge timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchMissionDecisionAnswer(
    token,
    id,
    { answer, challengeId, signature, signal = null } = {}
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(
        `${amosOrigin(this.mcpUrl)}/api/v1/mission-decisions/${encodeURIComponent(id)}/answer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            answer,
            challenge_id: challengeId,
            signature
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS Mission decision answer timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchIntelligenceStatus(token, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(`${amosOrigin(this.mcpUrl)}/v1/intelligence/status`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS account status request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }
}

export function parseMcpJson(result, label = "AMOS") {
  const text = extractMcpText(result);
  if (!text) throw new Error(`${label} returned no data`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid response`);
  }
}

export function amosOrigin(mcpUrl) {
  const url = new URL(mcpUrl);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("AMOS Desktop requires HTTPS except for localhost development");
  }
  return url.origin;
}

export function approvalReviewUrl(mcpUrl, approval) {
  if (approval?.approval_url) {
    const supplied = new URL(approval.approval_url);
    if (supplied.origin !== amosOrigin(mcpUrl)) {
      throw new Error("AMOS approval URL does not match the connected server");
    }
    return supplied.toString();
  }
  const id = String(approval?.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid AMOS approval id");
  return `${amosOrigin(mcpUrl)}/approvals/${encodeURIComponent(id)}`;
}

export function missionDecisionReviewUrl(mcpUrl, decision) {
  if (decision?.decision_url) {
    const supplied = new URL(decision.decision_url);
    if (supplied.origin !== amosOrigin(mcpUrl)) {
      throw new Error("AMOS Mission decision URL does not match the connected server");
    }
    return supplied.toString();
  }
  const id = String(decision?.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid AMOS Mission decision id");
  return `${amosOrigin(mcpUrl)}/mission-decisions/${encodeURIComponent(id)}`;
}

function normalizeApproval(value) {
  if (!value || typeof value !== "object" || !value.id || !value.verb) return null;
  return {
    id: String(value.id),
    verb: String(value.verb),
    review_summary: String(value.review_summary || humanizeVerb(value.verb)).slice(0, 500),
    approval_url: value.approval_url ? String(value.approval_url) : "",
    requested_by: String(value.requested_by || ""),
    status: String(value.status || "pending"),
    requested_at: String(value.requested_at || ""),
    decided_at: value.decided_at ? String(value.decided_at) : "",
    decided_by: value.decided_by ? String(value.decided_by) : "",
    last_error: value.last_error ? String(value.last_error) : "",
    agency_origin: String(value.agency_origin || "human_directed"),
    goal_id: value.goal_id ? String(value.goal_id) : "",
    args: value.args && typeof value.args === "object" ? value.args : {},
    execution_result:
      value.execution_result !== undefined && value.execution_result !== null
        ? value.execution_result
        : null,
    execution_result_sha256: value.execution_result_sha256
      ? String(value.execution_result_sha256)
      : "",
    execution_result_truncated: value.execution_result_truncated === true
  };
}

function normalizeMissionDecision(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  const missionId = String(value.mission_id || "").trim();
  const question = String(value.question || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(missionId) || !question) {
    return null;
  }
  return {
    id,
    mission_id: missionId,
    contract_id: String(value.contract_id || ""),
    mission_name: String(value.mission_name || "Mission").slice(0, 200),
    objective: String(value.objective || "").slice(0, 2_000),
    question: question.slice(0, 4_000),
    context: value.context && typeof value.context === "object" ? boundedJsonValue(value.context) : {},
    options: Array.isArray(value.options)
      ? value.options.map((option) => String(option).trim().slice(0, 500)).filter(Boolean).slice(0, 12)
      : [],
    authority_expansion: value.authority_expansion === true,
    created_at: String(value.created_at || ""),
    decision_url: value.decision_url ? String(value.decision_url) : ""
  };
}

function normalizeContinuityResponse(value, { tenantId = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AMOS working continuity returned an invalid response");
  }
  if (value.available !== true) {
    return {
      supported: true,
      available: false,
      cleared: value.cleared === true,
      contextKey: String(value.context_key || "active").slice(0, 128),
      revision: 0,
      sourceClient: "",
      updatedAt: null,
      stale: false,
      manifest: null
    };
  }
  const manifest = normalizeSharedContinuityManifest(value.manifest, { tenantId });
  return {
    supported: true,
    available: true,
    cleared: false,
    contextKey: String(value.context_key || manifest.scope.contextKey).slice(0, 128),
    revision: Math.max(1, Math.min(Number(value.revision) || manifest.revision, Number.MAX_SAFE_INTEGER)),
    sourceClient: String(value.source_client || "").slice(0, 64),
    updatedAt: manifest.updatedAt,
    stale: value.stale === true,
    manifest
  };
}

function unsupportedCollaborationProfile() {
  return {
    supported: false,
    available: false,
    revision: 0,
    profile: emptyRelationshipProfile()
  };
}

function normalizeCollaborationProfileResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AMOS collaboration profile returned an invalid response");
  }
  const profile = normalizeRelationshipProfile(value.profile);
  profile.revision = Math.max(0, Number(value.revision ?? profile.revision ?? 0));
  return {
    supported: true,
    available: value.available === true,
    revision: profile.revision,
    profile
  };
}

function isUnknownTool(error, name) {
  const message = String(error?.message || "");
  return new RegExp(`unknown tool ['\"]${name}['\"]`, "i").test(message) ||
    (message.includes("-32601") && message.includes(name));
}

function normalizeReceipt(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  const operation = String(value.operation || "").trim();
  if (!id || !operation) return null;
  const receipt = value.receipt && typeof value.receipt === "object"
    ? value.receipt
    : {};
  return {
    id,
    operation: operation.slice(0, 160),
    actor: String(value.actor || receipt.actor || "").slice(0, 160),
    agency: String(value.agency || receipt.agency || "legacy_unclassified").slice(0, 80),
    lifecycleState: String(
      value.lifecycle_state || receipt.lifecycle_state || "legacy_unclassified"
    ).slice(0, 80),
    effectApplied:
      typeof value.effect_applied === "boolean"
        ? value.effect_applied
        : typeof receipt.effect_applied === "boolean"
          ? receipt.effect_applied
          : null,
    verified: value.verified === true,
    summary: String(
      receipt.result_summary || receipt.intent?.summary || operation
    ).slice(0, 500),
    createdAt: String(value.created_at || receipt.emitted_at || "")
  };
}

function normalizeAutomation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = String(value.id || "").trim().slice(0, 128);
  const name = String(value.name || "").trim().slice(0, 200);
  if (!id || !name) return null;
  const trigger = value.trigger && typeof value.trigger === "object" && !Array.isArray(value.trigger)
    ? Object.fromEntries(
        ["type", "kind", "event", "collection", "field", "cadence", "schedule", "source"]
          .filter((key) => value.trigger[key] !== undefined)
          .map((key) => [key, boundedJsonValue(value.trigger[key])])
      )
    : {};
  const stats = value.stats && typeof value.stats === "object" ? value.stats : {};
  return {
    id,
    name,
    status: ["active", "paused", "draft", "archived"].includes(value.status)
      ? value.status
      : String(value.status || "unknown").slice(0, 40),
    trigger,
    liveCopySubject: String(value.live_copy_subject || "").slice(0, 500),
    templateKey: String(value.template_key || "").slice(0, 120),
    templateVersion: boundedCount(value.template_version),
    blueprintKey: String(value.blueprint_key || "").slice(0, 120),
    createdBy: String(value.created_by || "").slice(0, 128),
    definitionVersion: boundedCount(value.definition_version),
    definitionSha256: /^[0-9a-f]{64}$/i.test(String(value.definition_sha256 || ""))
      ? String(value.definition_sha256).toLowerCase()
      : "",
    steps: (Array.isArray(value.steps_summary) ? value.steps_summary : [])
      .slice(0, 40)
      .flatMap((step) => {
        if (!step || typeof step !== "object") return [];
        const action = String(step.action || "").trim().slice(0, 120);
        if (!action) return [];
        return [{
          action,
          stage: String(step.stage || "").slice(0, 120),
          stepKey: String(step.step_key || "").slice(0, 120),
          verb: String(step.verb || "").slice(0, 120),
          approvalMode: String(step.approval_mode || "").slice(0, 80),
          subject: String(step.subject || "").slice(0, 500),
          instructions: String(step.instructions || "").slice(0, 500)
        }];
      }),
    stats: {
      enrolled: boundedCount(stats.enrolled),
      sent: boundedCount(stats.sent),
      emailsSent: boundedCount(stats.emails_sent),
      pending: boundedCount(stats.pending),
      completed: boundedCount(stats.completed),
      failed: boundedCount(stats.failed),
      unsubscribed: boundedCount(stats.unsubscribed),
      lastSentAt: safeTimestamp(stats.last_sent_at),
      calendarEventsEvaluated: boundedCount(stats.calendar_events_evaluated),
      calendarEventsMatched: boundedCount(stats.calendar_events_matched),
      lastCalendarEventAt: safeTimestamp(stats.last_calendar_event_at),
      toolRuns: boundedCount(stats.tool_runs),
      toolRunsExecuted: boundedCount(stats.tool_runs_executed),
      toolRunsParked: boundedCount(stats.tool_runs_parked),
      toolRunsFailed: boundedCount(stats.tool_runs_failed),
      lastToolRunAt: safeTimestamp(stats.last_tool_run_at)
    },
    createdAt: safeTimestamp(value.created_at),
    updatedAt: safeTimestamp(value.updated_at)
  };
}

function emptyAutomationsLibrary() {
  return {
    supported: false,
    automations: [],
    grantsSupported: false,
    grants: [],
    operationsSupported: false,
    failures: [],
    runs: [],
    operationsContract: {}
  };
}

function optionalAutomationPayload(settled, tool, label) {
  if (settled.status === "fulfilled") return parseMcpJson(settled.value, label);
  if (isUnknownTool(settled.reason, tool)) return null;
  throw settled.reason;
}

function normalizeAutomationFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = validUuidOrEmpty(value.id);
  const automationId = validUuidOrEmpty(value.automation_id);
  const enrollmentId = validUuidOrEmpty(value.enrollment_id);
  if (!id || !automationId || !enrollmentId) return null;
  const notification = value.notification && typeof value.notification === "object"
    ? value.notification
    : {};
  return {
    id,
    automationId,
    automationName: String(value.automation_name || "Automation").slice(0, 200),
    enrollmentId,
    subjectKey: String(value.subject_key || "").slice(0, 200),
    runStatus: String(value.run_status || "failed").slice(0, 40),
    stepPosition: boundedCount(value.step_position),
    stepKey: String(value.step_key || "").slice(0, 120),
    failureKind: ["retryable", "configuration", "ambiguous", "permanent"].includes(
      value.failure_kind
    ) ? value.failure_kind : "permanent",
    replaySafe: value.replay_safe === true,
    externalEffectState: ["unknown", "not_applied", "applied"].includes(
      value.external_effect_state
    ) ? value.external_effect_state : "unknown",
    status: String(value.status || "open").slice(0, 40),
    error: String(value.error || "Automation step failed").slice(0, 1_000),
    occurrenceCount: boundedCount(value.occurrence_count),
    notificationState: String(notification.state || "pending").slice(0, 40),
    notificationError: String(notification.error || "").slice(0, 500),
    notifiedAt: safeTimestamp(notification.notified_at),
    definitionVersion: boundedCount(value.definition_version),
    definitionSha256: /^[0-9a-f]{64}$/i.test(String(value.definition_sha256 || ""))
      ? String(value.definition_sha256).toLowerCase()
      : "",
    firstFailedAt: safeTimestamp(value.first_failed_at),
    lastFailedAt: safeTimestamp(value.last_failed_at),
    resolvedAt: safeTimestamp(value.resolved_at),
    resolutionNote: String(value.resolution_note || "").slice(0, 1_000)
  };
}

function normalizeAutomationRun(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = validUuidOrEmpty(value.id);
  const automationId = validUuidOrEmpty(value.automation_id);
  if (!id || !automationId) return null;
  const step = value.step && typeof value.step === "object" ? value.step : {};
  const incident = value.incident && typeof value.incident === "object" ? value.incident : null;
  return {
    id,
    automationId,
    automationName: String(value.automation_name || "Automation").slice(0, 200),
    subjectKey: String(value.subject_key || "").slice(0, 200),
    currentPosition: boundedCount(value.current_position),
    status: String(value.status || "unknown").slice(0, 40),
    attempts: boundedCount(value.attempts),
    exitReason: String(value.exit_reason || "").slice(0, 500),
    trigger: boundedJsonValue(value.trigger || {}),
    startedAt: safeTimestamp(value.started_at),
    updatedAt: safeTimestamp(value.updated_at),
    durationMs: boundedCount(value.duration_ms),
    nextRunAt: safeTimestamp(value.next_run_at),
    step: {
      id: validUuidOrEmpty(step.id),
      key: String(step.key || "").slice(0, 120),
      status: String(step.status || "").slice(0, 40),
      startedAt: safeTimestamp(step.started_at),
      completedAt: safeTimestamp(step.completed_at)
    },
    incident: incident ? {
      id: validUuidOrEmpty(incident.id),
      kind: String(incident.kind || "").slice(0, 40),
      replaySafe: incident.replay_safe === true,
      status: String(incident.status || "").slice(0, 40)
    } : null
  };
}

function normalizeAutomationGrant(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = String(value.id || "").trim();
  const automationId = String(value.automation_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(automationId)) return null;
  const status = String(value.status || "unknown").slice(0, 40);
  return {
    id,
    automationId,
    automationName: String(value.automation_name || "").slice(0, 200),
    definitionVersion: boundedCount(value.automation_definition_version),
    definitionSha256: /^[0-9a-f]{64}$/i.test(String(value.automation_definition_sha256 || ""))
      ? String(value.automation_definition_sha256).toLowerCase()
      : "",
    stepPosition: boundedCount(value.step_position),
    stepKey: String(value.step_key || "").slice(0, 120),
    connectionId: String(value.connection_id || "").slice(0, 128),
    operationContractId: String(value.operation_contract_id || "").slice(0, 128),
    operationKey: String(value.operation_key || "").slice(0, 64),
    triggerScope: boundedJsonValue(value.trigger_scope || {}),
    argumentScope: boundedJsonValue(value.argument_scope || []),
    window: ["hour", "day"].includes(value.window) ? value.window : "day",
    maxRunsPerWindow: boundedCount(value.max_runs_per_window),
    windowRuns: boundedCount(value.window_runs),
    maxTotalRuns: boundedCount(value.max_total_runs),
    totalRuns: boundedCount(value.total_runs),
    maxConsecutiveFailures: boundedCount(value.max_consecutive_failures),
    consecutiveFailures: boundedCount(value.consecutive_failures),
    status,
    expiresAt: safeTimestamp(value.expires_at),
    lastClaimedAt: safeTimestamp(value.last_claimed_at),
    lastSucceededAt: safeTimestamp(value.last_succeeded_at),
    lastFailedAt: safeTimestamp(value.last_failed_at),
    statusReason: String(value.status_reason || "").slice(0, 500),
    createdAt: safeTimestamp(value.created_at),
    updatedAt: safeTimestamp(value.updated_at)
  };
}

function normalizeTaskResource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = String(value.id || "").trim();
  const contextKey = String(value.context_key || value.contextKey || "").trim().slice(0, 128);
  const title = String(value.title || "").trim().slice(0, 160);
  const objective = String(value.objective || "").trim().slice(0, 6_000);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9._:-]+$/.test(contextKey) || !title || !objective) {
    return null;
  }
  const workspaceMode = String(value.workspace_mode || value.workspaceMode || "same_directory");
  return {
    id,
    contextKey,
    title,
    objective,
    kind: ["general", "automation_builder", "goal_pursuit", "fork"].includes(value.kind)
      ? value.kind
      : "general",
    status: ["active", "waiting", "completed", "failed", "interrupted"].includes(value.status)
      ? value.status
      : "active",
    sourceClient: String(value.source_client || value.sourceClient || "unknown").slice(0, 64),
    pinned: value.pinned === true,
    archived: value.archived === true,
    archivedAt: safeTimestamp(value.archived_at || value.archivedAt),
    parentTaskId: String(value.parent_task_id || value.parentTaskId || "").slice(0, 128),
    projectId: validUuidOrEmpty(value.project_id || value.projectId),
    sourceEventId: String(value.source_event_id || value.sourceEventId || "").slice(0, 160),
    workspaceMode: ["same_directory", "new_worktree", "context_only"].includes(workspaceMode)
      ? workspaceMode
      : "same_directory",
    workspace: normalizePortableWorkspace(value.workspace),
    resourceRefs: normalizeStringList(value.resource_refs || value.resourceRefs, 40, 1_024),
    forkManifest: normalizeRemoteForkManifest(value.fork_manifest || value.forkManifest),
    childCount: boundedCount(value.child_count || value.childCount),
    createdAt: safeTimestamp(value.created_at || value.createdAt),
    updatedAt: safeTimestamp(value.updated_at || value.updatedAt)
  };
}

function emptyProjectsLibrary() {
  return {
    supported: false,
    projects: [],
    inbox: [],
    stalledCount: 0,
    projectContract: null,
    runContract: null
  };
}

function normalizeMissionTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = String(value.key || value.id || "").trim().slice(0, 80);
  const label = String(value.title || value.label || "").trim().slice(0, 160);
  const objective = String(value.objective || "").trim().slice(0, 4_000);
  if (!id || !label || !objective) return null;
  return {
    id,
    kind: value.kind === "optimization" ? "optimization" : "finite",
    label,
    detail: String(value.description || value.detail || "").trim().slice(0, 500),
    objective
  };
}

function normalizeOptimizationMission(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = validUuidOrEmpty(value.id);
  const objective = String(value.objective || "").trim().slice(0, 4_000);
  if (!id || !objective) return null;
  const events = Array.isArray(value.events) ? boundedJsonValue(value.events) : [];
  const latest = events[0] || null;
  return {
    id,
    name: objective.length > 100 ? `${objective.slice(0, 97)}…` : objective,
    objective,
    status: String(value.status || "active").slice(0, 40),
    statusReason: String(
      value.latest_proposal || latest?.proposal || value.capability_state_detail || ""
    ).slice(0, 1_000),
    missionKind: "optimization",
    executionLocation: "hosted",
    metric: String(value.metric_label || value.metric || "").slice(0, 160),
    cadence: String(value.cadence_label || value.cadence || "").slice(0, 80),
    mode: String(value.mode_label || value.mode || "").slice(0, 80),
    cycles: boundedCount(value.cycles),
    progressPercent: boundedCount(value.progress_percent),
    pendingApprovals: boundedCount(value.pending_approvals),
    latestValue: String(value.latest_value || "").slice(0, 160),
    latestDelta: String(value.latest_delta || "").slice(0, 160),
    nextRun: String(value.next_run || "").slice(0, 160),
    events,
    createdAt: safeTimestamp(value.created_at || value.createdAt),
    updatedAt: safeTimestamp(latest?.created_at || value.last_activity || value.updatedAt)
  };
}

function normalizeMission(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = validUuidOrEmpty(value.mission_id || value.missionId);
  const name = String(value.name || "").trim().slice(0, 160);
  const objective = String(value.objective || "").trim().slice(0, 4_000);
  if (!id || !name || !objective) return null;
  const contract = value.contract && typeof value.contract === "object" ? value.contract : {};
  const budgets = contract.budgets && typeof contract.budgets === "object"
    ? contract.budgets
    : contract;
  const status = String(value.status || "authorized").slice(0, 40);
  return {
    id,
    name,
    objective,
    projectId: validUuidOrEmpty(value.project_id || value.projectId),
    projectName: String(value.project_name || value.projectName || "").trim().slice(0, 160),
    status,
    statusReason: String(value.status_reason || value.statusReason || "").slice(0, 1_000),
    intelligence: ["amos", "byok", "local"].includes(value.intelligence)
      ? value.intelligence
      : "amos",
    executionLocation: "hosted",
    resumeUrl: String(value.resume_url || value.resumeUrl || "").slice(0, 2_000),
    completionCondition: boundedJsonValue(
      value.completion_condition || value.completionCondition || null
    ),
    contract: {
      id: validUuidOrEmpty(contract.contract_id || contract.id),
      status: String(contract.status || "").slice(0, 40),
      maxToolCalls: boundedCount(budgets.max_tool_calls),
      usedToolCalls: boundedCount(budgets.used_tool_calls),
      maxCostMicrousd: boundedCount(budgets.max_cost_microusd),
      usedCostMicrousd: boundedCount(budgets.used_cost_microusd),
      maxProviderCredits: boundedCount(budgets.max_provider_credits),
      usedProviderCredits: boundedCount(budgets.used_provider_credits),
      maxWallTimeSeconds: boundedCount(budgets.max_wall_time_seconds),
      expiresAt: safeTimestamp(contract.expires_at || contract.expiresAt)
    },
    steps: Array.isArray(value.steps) ? boundedJsonValue(value.steps) : [],
    verification: Array.isArray(value.verification) ? boundedJsonValue(value.verification) : [],
    decisions: Array.isArray(value.decisions) ? boundedJsonValue(value.decisions) : [],
    // The channel choice persisted with the Mission, and any delivery evidence the full read embeds.
    notifications: normalizeMissionNotificationChoice(
      value.notifications ?? value.notification_channels ?? contract.notifications ?? null
    ),
    notificationDelivery: normalizeMissionNotificationDelivery(
      value.notification_delivery ?? value.notificationDelivery
    ),
    createdAt: safeTimestamp(value.created_at || value.createdAt),
    startedAt: safeTimestamp(value.started_at || value.startedAt),
    finishedAt: safeTimestamp(value.finished_at || value.finishedAt)
  };
}

function missionSpecArgs(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("A Mission needs a compiled Run Contract specification");
  }
  const args = { ...spec };
  delete args.dry_run;
  delete args.confirmation_token;
  return args;
}

function normalizeProject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = validUuidOrEmpty(value.id);
  const name = String(value.name || "").trim().slice(0, 160);
  if (!id || !name) return null;
  const budget = value.default_budget && typeof value.default_budget === "object"
    ? value.default_budget
    : {};
  return {
    id,
    name,
    instructions: String(value.instructions || "").trim().slice(0, 12_000),
    status: ["active", "paused", "completed"].includes(value.status)
      ? value.status
      : "active",
    pinned: value.pinned === true,
    archived: value.archived === true,
    archivedAt: safeTimestamp(value.archived_at || value.archivedAt),
    resourceRefs: normalizeStringList(value.resource_refs || value.resourceRefs, 40, 1_024),
    maxParallelRuns: boundedPositive(value.max_parallel_runs || value.maxParallelRuns, 4, 32),
    defaultBudget: {
      tokenLimit: boundedPositive(budget.token_limit, 200_000, 1_000_000_000),
      costLimitMicrousd: boundedPositive(budget.cost_limit_microusd, 50_000_000, 100_000_000_000),
      toolCallLimit: boundedPositive(budget.tool_call_limit, 200, 100_000),
      wallTimeLimitSeconds: boundedPositive(budget.wall_time_limit_seconds, 14_400, 604_800)
    },
    taskCount: boundedCount(value.task_count || value.taskCount),
    runningCount: boundedCount(value.running_count || value.runningCount),
    createdAt: safeTimestamp(value.created_at || value.createdAt),
    updatedAt: safeTimestamp(value.updated_at || value.updatedAt)
  };
}

function normalizeTaskRun(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = validUuidOrEmpty(value.id);
  const projectId = validUuidOrEmpty(value.project_id || value.projectId);
  const taskId = validUuidOrEmpty(value.task_id || value.taskId);
  if (!id || !projectId || !taskId) return null;
  const budget = value.budget && typeof value.budget === "object" ? value.budget : {};
  const usage = value.usage && typeof value.usage === "object" ? value.usage : {};
  const status = [
    "scheduled", "running", "waiting", "blocked", "cancel_requested",
    "completed", "failed", "cancelled", "interrupted"
  ].includes(value.status) ? value.status : "scheduled";
  const executionMode = value.execution_mode || value.executionMode;
  return {
    id,
    projectId,
    projectName: String(value.project_name || value.projectName || "").slice(0, 160),
    taskId,
    taskTitle: String(value.task_title || value.taskTitle || "").slice(0, 160),
    sourceClient: String(value.source_client || value.sourceClient || "unknown").slice(0, 64),
    clientRunId: String(value.client_run_id || value.clientRunId || "").slice(0, 160),
    executionMode: ["local", "hosted", "external"].includes(executionMode)
      ? executionMode
      : "local",
    status,
    sequence: boundedCount(value.sequence),
    phase: String(value.phase || "").slice(0, 160),
    progressSummary: String(value.progress_summary || value.progressSummary || "").slice(0, 4_000),
    resultSummary: String(value.result_summary || value.resultSummary || "").slice(0, 8_000),
    stopReason: String(value.stop_reason || value.stopReason || "").slice(0, 1_000),
    budget: {
      tokenLimit: boundedPositive(budget.token_limit, 1, 1_000_000_000),
      costLimitMicrousd: boundedPositive(budget.cost_limit_microusd, 1, 100_000_000_000),
      toolCallLimit: boundedPositive(budget.tool_call_limit, 1, 100_000),
      wallTimeLimitSeconds: boundedPositive(budget.wall_time_limit_seconds, 1, 604_800)
    },
    usage: {
      tokensUsed: boundedCount(usage.tokens_used),
      costUsedMicrousd: boundedCount(usage.cost_used_microusd),
      toolCallsUsed: boundedCount(usage.tool_calls_used)
    },
    continue: value.continue !== false && status !== "cancel_requested" &&
      !["completed", "failed", "cancelled", "interrupted"].includes(status),
    stalled: value.stalled === true,
    cancelRequestedAt: safeTimestamp(value.cancel_requested_at || value.cancelRequestedAt),
    startedAt: safeTimestamp(value.started_at || value.startedAt),
    heartbeatAt: safeTimestamp(value.heartbeat_at || value.heartbeatAt),
    finishedAt: safeTimestamp(value.finished_at || value.finishedAt),
    createdAt: safeTimestamp(value.created_at || value.createdAt),
    updatedAt: safeTimestamp(value.updated_at || value.updatedAt)
  };
}

function projectMutationArgs(input = {}, { partial = false } = {}) {
  const args = {};
  if (!partial || Object.hasOwn(input, "name")) {
    args.name = requiredBoundedText(input.name, 160, "Project name");
  }
  for (const [source, target, limit] of [
    ["instructions", "instructions", 12_000]
  ]) {
    if (Object.hasOwn(input, source)) args[target] = String(input[source] || "").slice(0, limit);
  }
  if (Object.hasOwn(input, "status")) {
    if (!["active", "paused", "completed"].includes(input.status)) {
      throw new Error("AMOS blocked an invalid Project status");
    }
    args.status = input.status;
  }
  for (const [source, target] of [["pinned", "pinned"], ["archived", "archived"]]) {
    if (Object.hasOwn(input, source)) args[target] = input[source] === true;
  }
  if (Object.hasOwn(input, "resourceRefs")) {
    args.resource_refs = normalizeStringList(input.resourceRefs, 40, 1_024);
  }
  for (const [source, target, fallback, maximum] of [
    ["maxParallelRuns", "max_parallel_runs", 4, 32],
    ["tokenLimit", "token_limit", 200_000, 1_000_000_000],
    ["costLimitMicrousd", "cost_limit_microusd", 50_000_000, 100_000_000_000],
    ["toolCallLimit", "tool_call_limit", 200, 100_000],
    ["wallTimeLimitSeconds", "wall_time_limit_seconds", 14_400, 604_800]
  ]) {
    if (Object.hasOwn(input, source)) args[target] = boundedPositive(input[source], fallback, maximum);
  }
  if (partial && Object.keys(args).length === 0) {
    throw new Error("Choose at least one Project field to update");
  }
  return args;
}

function taskRunStartArgs(input = {}) {
  const executionMode = String(input.executionMode || "local");
  const status = String(input.status || "running");
  if (!["local", "hosted", "external"].includes(executionMode)) {
    throw new Error("AMOS blocked an invalid task-run execution mode");
  }
  if (!["scheduled", "running"].includes(status)) {
    throw new Error("AMOS blocked an invalid task-run status");
  }
  const args = {
    project_id: requiredUuid(input.projectId, "Project"),
    task_id: requiredUuid(input.taskId, "Task"),
    source_client: requiredIdentifier(input.sourceClient || "amos_desktop", 64, "Task-run source"),
    client_run_id: requiredIdentifier(input.clientRunId, 160, "Task-run client id"),
    execution_mode: executionMode,
    status
  };
  for (const [source, target, maximum] of [
    ["tokenLimit", "token_limit", 1_000_000_000],
    ["costLimitMicrousd", "cost_limit_microusd", 100_000_000_000],
    ["toolCallLimit", "tool_call_limit", 100_000],
    ["wallTimeLimitSeconds", "wall_time_limit_seconds", 604_800]
  ]) {
    if (Object.hasOwn(input, source)) args[target] = boundedPositive(input[source], 1, maximum);
  }
  return args;
}

function taskRunReportArgs(input = {}) {
  const status = String(input.status || "running");
  if (!["running", "waiting", "blocked", "completed", "failed", "cancelled", "interrupted"].includes(status)) {
    throw new Error("AMOS blocked an invalid task-run report status");
  }
  return {
    run_id: requiredUuid(input.runId, "Task run"),
    sequence: boundedPositive(input.sequence, 1, Number.MAX_SAFE_INTEGER),
    status,
    phase: String(input.phase || "").slice(0, 160),
    progress_summary: String(input.progressSummary || "").slice(0, 4_000),
    result_summary: String(input.resultSummary || "").slice(0, 8_000),
    tokens_used: boundedCount(input.tokensUsed),
    cost_used_microusd: boundedCount(input.costUsedMicrousd),
    tool_calls_used: boundedCount(input.toolCallsUsed)
  };
}

function boundedPositive(value, fallback, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1
    ? Math.min(number, maximum)
    : fallback;
}

function boundedContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return boundedJsonValue(value);
}

function validUuidOrEmpty(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : "";
}

function normalizeTaskMutation(value, action) {
  const task = normalizeTaskResource(value?.task);
  if (!task) throw new Error(`AMOS task ${action} returned an invalid task`);
  return {
    task,
    parent: normalizeTaskResource(value?.parent),
    forkManifest: normalizeRemoteForkManifest(value?.fork_manifest || value?.forkManifest),
    contract: value?.contract && typeof value.contract === "object" ? value.contract : null
  };
}

function taskRegistrationArgs(input = {}) {
  const id = input.id ? requiredUuid(input.id, "Task") : undefined;
  const kind = String(input.kind || "general");
  const status = String(input.status || "active");
  const workspaceMode = String(input.workspaceMode || "same_directory");
  if (!["general", "automation_builder", "goal_pursuit", "fork"].includes(kind)) {
    throw new Error("AMOS blocked an invalid task type");
  }
  if (!["active", "waiting", "completed", "failed", "interrupted"].includes(status)) {
    throw new Error("AMOS blocked an invalid task status");
  }
  if (!["same_directory", "new_worktree", "context_only"].includes(workspaceMode)) {
    throw new Error("AMOS blocked an invalid task workspace mode");
  }
  return {
    ...(id ? { task_id: id } : {}),
    context_key: requiredIdentifier(input.contextKey, 128, "Task context"),
    title: requiredBoundedText(input.title, 160, "Task title"),
    objective: requiredBoundedText(input.objective, 6_000, "Task objective"),
    kind,
    status,
    source_client: "amos_desktop",
    workspace_mode: workspaceMode,
    workspace: normalizePortableWorkspace(input.workspace),
    resource_refs: normalizeStringList(input.resourceRefs, 40, 1_024)
  };
}

function taskForkArgs(input = {}) {
  const contextScope = String(input.contextScope || "from_here");
  const workspaceMode = String(input.workspaceMode || "same_directory");
  if (!["everything", "from_here", "selected_artifacts"].includes(contextScope)) {
    throw new Error("AMOS blocked an invalid task context scope");
  }
  if (!["same_directory", "new_worktree", "context_only"].includes(workspaceMode)) {
    throw new Error("AMOS blocked an invalid task workspace mode");
  }
  const selectedArtifacts = normalizeStringList(input.selectedArtifacts, 40, 1_024);
  if (contextScope === "selected_artifacts" && selectedArtifacts.length === 0) {
    throw new Error("Choose at least one artifact for this task fork");
  }
  return {
    task_id: requiredUuid(input.taskId, "Task"),
    name: requiredBoundedText(input.name, 160, "Fork name"),
    objective: requiredBoundedText(input.objective, 6_000, "Fork objective"),
    source_event_id: requiredIdentifier(input.sourceEventId, 160, "Fork source event"),
    context_scope: contextScope,
    workspace_mode: workspaceMode,
    workspace: normalizePortableWorkspace(input.workspace),
    selected_artifacts: selectedArtifacts,
    source_client: "amos_desktop"
  };
}

function normalizePortableWorkspace(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const repository = String(source.repository || "").trim().slice(0, 500);
  if (repository.startsWith("/") || /^[a-z]:[\\/]/i.test(repository)) {
    throw new Error("AMOS will not send an absolute local workspace path to Platform");
  }
  const commit = String(source.commit || "").trim();
  return {
    label: String(source.label || "").trim().slice(0, 160),
    repository,
    branch: String(source.branch || "").trim().slice(0, 300),
    commit: /^[a-f0-9]{7,64}$/i.test(commit) ? commit : "",
    dirty: source.dirty === true
  };
}

function normalizeRemoteForkManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value.scope && typeof value.scope === "object" ? value.scope : {};
  const safeguards = value.safeguards && typeof value.safeguards === "object"
    ? value.safeguards
    : {};
  if (
    safeguards.orientationOnly !== true ||
    safeguards.replayAllowed !== false ||
    safeguards.pendingOperationsCopied !== false ||
    safeguards.credentialsIncluded !== false ||
    safeguards.executionAuthorityIncluded !== false
  ) {
    throw new Error("AMOS task fork did not preserve its safety contract");
  }
  return {
    format: value.format === "amos.task_fork_manifest" ? value.format : "amos.task_fork_manifest",
    version: 1,
    parentTaskId: String(scope.parentTaskId || value.parentTaskId || "").slice(0, 128),
    childTaskId: String(scope.childTaskId || value.childTaskId || "").slice(0, 128),
    sourceEventId: String(scope.sourceEventId || value.sourceEventId || "").slice(0, 160),
    contextScope: String(scope.contextScope || value.contextScope || "from_here"),
    workspaceMode: String(scope.workspaceMode || value.workspaceMode || "same_directory"),
    selectedArtifacts: normalizeStringList(value.selectedArtifacts, 40, 1_024),
    safeguards: {
      orientationOnly: true,
      requiresFreshIdentity: true,
      requiresFreshCompanyEvidence: true,
      requiresFreshPolicy: true,
      requiresFreshApprovals: true,
      requiresFreshReceipts: true,
      replayAllowed: false,
      pendingOperationsCopied: false,
      credentialsIncluded: false,
      executionAuthorityIncluded: false
    }
  };
}

function normalizeResumeContract(value) {
  if (
    value?.automatic_replay !== false ||
    value?.fresh_identity_required !== true ||
    value?.fresh_company_evidence_required !== true ||
    value?.fresh_policy_required !== true ||
    value?.fresh_approvals_required !== true ||
    value?.fresh_receipts_required !== true
  ) {
    throw new Error("AMOS task resume did not preserve its revalidation contract");
  }
  return {
    automaticReplay: false,
    freshIdentityRequired: true,
    freshCompanyEvidenceRequired: true,
    freshPolicyRequired: true,
    freshApprovalsRequired: true,
    freshReceiptsRequired: true
  };
}

function normalizeStringList(value, maxItems, maxLength) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim().slice(0, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function requiredIdentifier(value, maxLength, label) {
  const result = requiredBoundedText(value, maxLength, label);
  if (!/^[A-Za-z0-9._:-]+$/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function requiredBoundedText(value, maxLength, label) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters`);
  }
  return result;
}

function boundedCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function safeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function boundedJsonValue(value) {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(boundedJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 20).map(([key, item]) => [key.slice(0, 80), boundedJsonValue(item)])
    );
  }
  return null;
}

function requiredText(value, maxLength, label) {
  const text = String(value || "").trim().slice(0, maxLength);
  if (!text) throw new Error(`${label} name is required`);
  return text;
}

function normalizeConnection(value) {
  if (!value || typeof value !== "object") return null;
  const provider = String(value.provider || "").trim();
  const displayName = String(value.display_name || "").trim();
  if (!provider || !displayName) return null;
  return {
    id: String(value.id || ""),
    provider,
    displayName,
    kind: String(value.kind || "connection"),
    status: String(value.status || "unknown"),
    ownership: String(value.ownership || "service_account"),
    usable: value.usable === true,
    createdAt: value.created_at || null
  };
}

function normalizeProvider(value) {
  if (!value || typeof value !== "object") return null;
  const provider = String(value.provider || "").trim();
  if (!provider) return null;
  return {
    provider,
    label: String(value.label || provider),
    source: String(value.source || "tenant"),
    connectionKind: String(value.connection_kind || "oauth"),
    group: value.group ? String(value.group) : "",
    description: value.description ? String(value.description) : "",
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.map((item) => String(item)).filter(Boolean)
      : [],
    setupMode: String(value.setup_mode || "hosted_oauth"),
    availability: String(
      value.availability ||
      ((value.configured === true || value.credentials_registered === true)
        ? "available"
        : "setup_required")
    ),
    upstreamStatus: value.upstream_status ? String(value.upstream_status) : "",
    configured: value.configured === true || value.credentials_registered === true,
    credentialForm: normalizeCredentialForm(value.credential_form)
  };
}

function normalizeCredentialForm(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const authScheme = String(value.auth_scheme || "bearer");
  if (!["bearer", "basic", "api_key"].includes(authScheme)) return null;
  return {
    authScheme,
    submissionTool: value.submission_tool
      ? String(value.submission_tool)
      : "create_connection",
    baseUrl: value.base_url ? String(value.base_url) : "",
    baseUrlEditable: value.base_url_editable === true,
    authSchemeEditable: value.auth_scheme_editable === true,
    customProvider: value.custom_provider === true,
    placeholder: value.placeholder ? String(value.placeholder) : "Paste credential",
    credentialLabel: value.credential_label
      ? String(value.credential_label)
      : "Secret key",
    help: value.help ? String(value.help) : "",
    usernameLabel: value.username_label ? String(value.username_label) : "",
    usernamePlaceholder: value.username_placeholder
      ? String(value.username_placeholder)
      : "",
    defaultFrom: value.default_from === true,
    contextField: normalizeCredentialContextField(value.context_field)
  };
}

function normalizeCredentialContextField(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = String(value.name || "");
  const type = String(value.type || "text");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(name) || !["text", "number"].includes(type)) {
    return null;
  }
  return {
    name,
    type,
    label: String(value.label || "Connection identifier"),
    placeholder: String(value.placeholder || "")
  };
}

function briefingDefinitionArgs(input = {}) {
  const title = String(input.title || "").trim();
  const objective = String(input.objective || "").trim();
  if (!title || title.length > 160) {
    throw new Error("A Briefing title must be between 1 and 160 characters");
  }
  if (!objective || objective.length > 4_000) {
    throw new Error("A Briefing objective must be between 1 and 4,000 characters");
  }
  const args = { title, objective };
  if (input.templateKey) args.template_key = String(input.templateKey);
  if (Array.isArray(input.sourcePlan)) args.source_plan = input.sourcePlan;
  if (input.parameters && typeof input.parameters === "object") {
    args.parameters = input.parameters;
  }
  if (input.presentation && typeof input.presentation === "object") {
    args.presentation = input.presentation;
  }
  return args;
}

function briefingRunArgs(input = {}) {
  if (input.briefingId) {
    return { briefing_id: requiredUuid(input.briefingId, "Briefing") };
  }
  const args = {};
  if (input.templateKey) args.template_key = String(input.templateKey);
  if (input.title) args.title = String(input.title);
  if (input.objective) args.objective = String(input.objective);
  if (Array.isArray(input.sourcePlan)) args.source_plan = input.sourcePlan;
  if (input.parameters && typeof input.parameters === "object") {
    args.parameters = input.parameters;
  }
  if (input.presentation && typeof input.presentation === "object") {
    args.presentation = input.presentation;
  }
  if (!args.template_key && !args.title) {
    throw new Error("Choose a saved Briefing or a platform template to run");
  }
  return args;
}

function normalizeBriefingCadence(input = {}) {
  const kind = String(input.kind || "");
  if (kind === "interval") {
    const everyMinutes = Number(input.everyMinutes ?? input.every_minutes);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 60 || everyMinutes > 10_080) {
      throw new Error("Briefing interval must be between 60 and 10,080 minutes");
    }
    return { kind, every_minutes: everyMinutes };
  }
  const hourUtc = Number(input.hourUtc ?? input.hour_utc);
  const minuteUtc = Number(input.minuteUtc ?? input.minute_utc ?? 0);
  if (
    !Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23 ||
    !Number.isInteger(minuteUtc) || minuteUtc < 0 || minuteUtc > 59
  ) {
    throw new Error("Choose a valid UTC time for this Briefing");
  }
  if (kind === "daily") return { kind, hour_utc: hourUtc, minute_utc: minuteUtc };
  if (kind === "weekly") {
    const weekday = Number(input.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error("Choose a weekday for this Briefing");
    }
    return { kind, weekday, hour_utc: hourUtc, minute_utc: minuteUtc };
  }
  throw new Error("Briefing cadence must be interval, daily, or weekly");
}

function requiredUuid(value, label) {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${label} id is invalid`);
  }
  return id;
}

function humanizeVerb(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid response (${response.status})`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])])
    );
  }
  return value;
}
