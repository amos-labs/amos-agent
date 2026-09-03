import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMissionChannelsConfigured,
  channelAvailability,
  defaultMissionChannels,
  emptyNotificationPreferences,
  hasSavedNotificationPreference,
  missionChannelsLabel,
  normalizeMissionNotificationChoice,
  normalizeMissionNotificationDelivery,
  normalizeNotificationPreferences,
  notificationPreferenceArgs
} from "../src/desktop/missionNotifications.js";
import { DesktopRemoteStateClient } from "../src/desktop/remoteState.js";

const platformPreferences = {
  preferences: {
    channels: { desktop_inapp: true, sms: true, secure_mobile_web: false },
    sms_number: "+15551234567",
    sms_number_verified: true,
    quiet_hours: { start: "22:00", end: "07:00" },
    timezone: "America/Chicago",
    utc_offset_minutes: -300
  },
  channels_available: ["desktop_inapp", "sms", "secure_mobile_web"],
  note: "SMS is delivered only to a verified number."
};

test("preferences normalize from the #727 payload; missing fields mean not configured, never verified", () => {
  const prefs = normalizeNotificationPreferences(platformPreferences);
  assert.equal(prefs.available, true);
  assert.deepEqual(prefs.channels, { in_app: true, sms: true, whatsapp: false, discord: false });
  assert.equal(prefs.smsNumber, "+15551234567");
  assert.equal(prefs.smsNumberVerified, true);
  assert.deepEqual(prefs.quietHours, { start: "22:00", end: "07:00" });
  assert.equal(prefs.timezone, "America/Chicago");
  assert.equal(prefs.utcOffsetMinutes, -300);
  // Today's server lists neither WhatsApp nor Discord: both are "coming", not configurable.
  assert.deepEqual(prefs.platformChannels, { in_app: true, sms: true, whatsapp: false, discord: false });
  assert.equal(channelAvailability("whatsapp", prefs).fix, "coming");
  assert.equal(channelAvailability("discord", prefs).reason, "Coming with the platform update.");

  const bare = normalizeNotificationPreferences({ preferences: { channels: { desktop_inapp: true } } });
  assert.equal(bare.smsNumber, "");
  assert.equal(bare.smsNumberVerified, false);
  assert.equal(bare.quietHours, null);
  assert.equal(channelAvailability("sms", bare).configured, false);
  assert.equal(channelAvailability("sms", bare).fix, "setup");
  assert.equal(channelAvailability("in_app", bare).configured, true);

  // A verified_at timestamp or the future whatsapp/discord flags are honoured once the server reports them.
  const future = normalizeNotificationPreferences({
    preferences: {
      channels: { desktop_inapp: true, sms: true, whatsapp: true, discord: true },
      sms_number: "+15551234567",
      sms_number_verified_at: "2026-09-01T00:00:00Z",
      discord_target: "channel:ops",
      discord_target_verified_at: "2026-09-01T00:00:00Z"
    },
    channels_available: ["desktop_inapp", "sms", "whatsapp", "discord"]
  });
  assert.equal(future.smsNumberVerified, true);
  assert.equal(future.discordTargetVerified, true);
  assert.equal(channelAvailability("whatsapp", future).configured, true);
  assert.equal(channelAvailability("discord", future).configured, true);
  assert.deepEqual(defaultMissionChannels(future), ["in_app", "sms", "whatsapp", "discord"]);

  // A verified-looking flag with no server channel listing still does not unlock the channel.
  const flagOnly = normalizeNotificationPreferences({
    preferences: { channels: { discord: true }, discord_target: "x", discord_target_verified: true },
    channels_available: ["desktop_inapp", "sms"]
  });
  assert.equal(channelAvailability("discord", flagOnly).configured, false);
  assert.deepEqual(defaultMissionChannels(flagOnly), ["in_app"]);
  assert.deepEqual(defaultMissionChannels(emptyNotificationPreferences()), ["in_app"]);
});

test("the Mission channel choice is bounded to the platform contract and labelled for people", () => {
  assert.deepEqual(
    normalizeMissionNotificationChoice({ channels: ["in_app", "SMS", "in_app", "fax", "desktop_inapp"] }),
    { channels: ["in_app", "sms"] }
  );
  assert.deepEqual(
    normalizeMissionNotificationChoice({ channels: ["discord"], discord_target: "  channel:ops  " }),
    { channels: ["discord"], discord_target: "channel:ops" }
  );
  // discord_target only travels with the discord channel.
  assert.deepEqual(
    normalizeMissionNotificationChoice({ channels: ["sms"], discord_target: "channel:ops" }),
    { channels: ["sms"] }
  );
  assert.equal(normalizeMissionNotificationChoice({ channels: [] }), null);
  assert.equal(normalizeMissionNotificationChoice(null), null);
  assert.equal(normalizeMissionNotificationChoice({ channels: "sms" }), null);
  assert.equal(missionChannelsLabel({ channels: ["in_app", "sms"] }), "In-app, SMS");
  assert.equal(missionChannelsLabel({ channels: ["whatsapp", "discord"] }), "WhatsApp, Discord");
  assert.equal(missionChannelsLabel(null), "");
});

test("an unconfigured channel is refused with a Settings pointer; configured ones pass through unchanged", () => {
  const prefs = normalizeNotificationPreferences(platformPreferences);
  assert.deepEqual(
    assertMissionChannelsConfigured({ channels: ["in_app", "sms"] }, prefs),
    { channels: ["in_app", "sms"] }
  );
  assert.throws(
    () => assertMissionChannelsConfigured({ channels: ["in_app", "discord"] }, prefs),
    /^Error: Discord: Coming with the platform update\.$/
  );
  const unverified = normalizeNotificationPreferences({
    preferences: { channels: { sms: true }, sms_number: "+15551234567", sms_number_verified: false }
  });
  assert.throws(
    () => assertMissionChannelsConfigured({ channels: ["sms"] }, unverified),
    /SMS: Verify your phone number\. Set it up in Settings → Notifications, then create the Mission\./
  );
  assert.throws(
    () => assertMissionChannelsConfigured({ channels: ["sms"] }, emptyNotificationPreferences()),
    /Connect your AMOS company to text Mission updates\./
  );
  assert.throws(() => assertMissionChannelsConfigured({ channels: [] }, prefs), /Choose at least one place/);
});

test("a saved preference means a verified external channel or quiet hours, so bare in-app defaults ask once", () => {
  assert.equal(hasSavedNotificationPreference(emptyNotificationPreferences()), false);
  assert.equal(hasSavedNotificationPreference(normalizeNotificationPreferences({ preferences: { channels: { desktop_inapp: true } } })), false);
  assert.equal(hasSavedNotificationPreference(normalizeNotificationPreferences(platformPreferences)), true);
  assert.equal(hasSavedNotificationPreference(normalizeNotificationPreferences({
    preferences: { channels: { desktop_inapp: true }, quiet_hours: { start: "22:00", end: "07:00" } }
  })), true);
  assert.equal(hasSavedNotificationPreference(normalizeNotificationPreferences({
    preferences: { channels: { sms: true }, sms_number: "+15551234567", sms_number_verified: false }
  })), false, "an unverified number is not a usable preference");
});

test("delivery rows keep channel, status, delivered_at, and last_error and nothing unbounded", () => {
  const rows = normalizeMissionNotificationDelivery([
    {
      id: "row-1", mission_id: "m", channel: "desktop_inapp", event_kind: "mission_started", status: "delivered",
      attempts: 1, delivered_at: "2026-09-02T12:00:00Z", last_error: null, payload: { big: "x".repeat(10_000) },
      created_at: "2026-09-02T11:59:00Z"
    },
    { id: "row-2", channel: "sms", event_kind: "decision_needed", status: "failed", attempts: 3, last_error: "Twilio 30003: unreachable" },
    { id: "row-3", channel: "sms", event_kind: "mission_finished", status: "suppressed", attempts: 0 },
    "junk",
    { id: "row-5", status: "pending" }
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    id: "row-1", channel: "in_app", eventKind: "mission_started", status: "delivered", attempts: 1,
    deliveredAt: "2026-09-02T12:00:00.000Z", acknowledgedAt: "", lastError: "", createdAt: "2026-09-02T11:59:00.000Z"
  });
  assert.equal(rows[1].lastError, "Twilio 30003: unreachable");
  assert.equal(rows[1].status, "failed");
  assert.equal(rows[2].status, "suppressed");
  assert.equal(Object.hasOwn(rows[0], "payload"), false);
});

test("set_notification_preferences arguments carry only what changed, in the platform's shape", () => {
  assert.deepEqual(
    notificationPreferenceArgs({
      channels: { in_app: true, sms: true, whatsapp: false },
      quietHours: { start: "22:00", end: "07:00" },
      utcOffsetMinutes: -300,
      timezone: "America/Chicago",
      smsNumber: "+1 (555) 123-4567"
    }),
    {
      channels: { desktop_inapp: true, sms: true, whatsapp: false },
      quiet_hours: { start: "22:00", end: "07:00" },
      utc_offset_minutes: -300,
      timezone: "America/Chicago",
      sms_number: "+15551234567"
    }
  );
  assert.deepEqual(notificationPreferenceArgs({ smsNumber: "", quietHours: null }), { sms_number: null, quiet_hours: null });
  assert.deepEqual(notificationPreferenceArgs({ channels: { sms: false } }), { channels: { sms: false } });
  assert.throws(() => notificationPreferenceArgs({ smsNumber: "555-1234" }), /international format/);
  assert.throws(() => notificationPreferenceArgs({ quietHours: { start: "22:00", end: "22:00" } }), /two different times/);
  assert.throws(() => notificationPreferenceArgs({ quietHours: { start: "10pm", end: "7am" } }), /HH:MM/);
});

function fakeRemote(handlers) {
  const client = Object.create(DesktopRemoteStateClient.prototype);
  client.calls = [];
  client.mcp = {
    async callTool(name, args) {
      client.calls.push({ name, args });
      if (!(name in handlers)) throw new Error(`MCP error -32601: unknown tool '${name}'`);
      const value = await handlers[name](args);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
  };
  return client;
}

test("the remote client speaks the #727 verbs and treats a server without them as not configured or unavailable", async () => {
  const missionId = "88888888-8888-4888-8888-888888888888";
  const remote = fakeRemote({
    get_notification_preferences: () => platformPreferences,
    set_notification_preferences: (args) => ({
      preferences: { ...platformPreferences.preferences, sms_number: args.sms_number, sms_number_verified: false },
      verification: { sms_verification: "code_sent" }
    }),
    verify_notification_phone: (args) => ({ verified: args.code === "123456", preferences: platformPreferences.preferences }),
    list_mission_notifications: (args) => ({
      mission_id: args.mission_id,
      count: 1,
      notification_delivery: [{ id: "r1", channel: "sms", event_kind: "mission_started", status: "delivered", attempts: 1, delivered_at: "2026-09-02T12:00:00Z" }]
    })
  });
  const prefs = await remote.getNotificationPreferences();
  assert.equal(prefs.smsNumberVerified, true);
  const saved = await remote.setNotificationPreferences({ smsNumber: "+15557654321", channels: { sms: true } });
  assert.deepEqual(remote.calls.at(-1).args, { channels: { sms: true }, sms_number: "+15557654321" });
  assert.equal(saved.preferences.smsNumberVerified, false);
  assert.deepEqual(saved.verification, { sms_verification: "code_sent" });
  const verified = await remote.verifyNotificationPhone("123 456");
  assert.deepEqual(remote.calls.at(-1).args, { code: "123456" });
  assert.equal(verified.verified, true);
  await assert.rejects(remote.verifyNotificationPhone("12"), /6-digit code/);
  const delivery = await remote.missionNotifications(missionId);
  assert.deepEqual(remote.calls.at(-1).args, { mission_id: missionId });
  assert.equal(delivery.supported, true);
  assert.equal(delivery.delivery[0].channel, "sms");
  assert.equal(delivery.delivery[0].deliveredAt, "2026-09-02T12:00:00.000Z");
  // The channel-change verb is still being added: a plain, coded "not available yet" error.
  await assert.rejects(
    remote.setMissionNotificationChannels(missionId, { channels: ["in_app", "sms"] }),
    (error) => error.code === "unsupported" && /not available yet/.test(error.message)
  );
  assert.deepEqual(remote.calls.at(-2).args, { mission_id: missionId, notifications: { channels: ["in_app", "sms"] } });

  const legacy = fakeRemote({});
  const missing = await legacy.getNotificationPreferences();
  assert.equal(missing.available, false);
  assert.equal(channelAvailability("sms", missing).configured, false);
  assert.deepEqual(await legacy.missionNotifications(missionId), { supported: false, missionId, delivery: [] });
  await assert.rejects(legacy.setNotificationPreferences({ channels: { sms: true } }), /does not yet store notification preferences/);
});

test("set_mission_notification_channels sends the exact contract and returns the persisted choice", async () => {
  const missionId = "99999999-9999-4999-8999-999999999999";
  const remote = fakeRemote({
    set_mission_notification_channels: (args) => ({ mission_id: args.mission_id, notifications: args.notifications })
  });
  const result = await remote.setMissionNotificationChannels(missionId, {
    channels: ["discord", "in_app"],
    discord_target: "channel:ops"
  });
  assert.deepEqual(remote.calls[0], {
    name: "set_mission_notification_channels",
    args: { mission_id: missionId, notifications: { channels: ["discord", "in_app"], discord_target: "channel:ops" } }
  });
  assert.deepEqual(result, {
    missionId,
    notifications: { channels: ["discord", "in_app"], discord_target: "channel:ops" }
  });
  await assert.rejects(remote.setMissionNotificationChannels(missionId, { channels: [] }), /Choose at least one place/);
});
