/**
 * Per-Mission notification channels.
 *
 * A Mission carries its own channel choice, `notifications: { channels: [...], discord_target? }`,
 * which the Platform persists on create_mission (and its dry run) and the outbox consults before
 * the user's saved preferences (get_notification_preferences). This module holds the pure
 * helpers shared by the controller, the remote-state client, and the renderer: the channel
 * vocabulary, the preference normalizer, and the rule that a channel the user has not set up
 * (no verified phone, no Discord target) is shown disabled and never silently sent.
 */

export const MISSION_NOTIFICATION_CHANNELS = Object.freeze(["in_app", "sms", "whatsapp", "discord"]);

export const MISSION_CHANNEL_LABELS = Object.freeze({
  in_app: "In-app",
  sms: "SMS",
  whatsapp: "WhatsApp",
  discord: "Discord"
});

// The Platform names the in-app channel "desktop_inapp" in preferences; Missions name it "in_app".
const PREFERENCE_CHANNEL_KEYS = Object.freeze({
  in_app: "desktop_inapp",
  sms: "sms",
  whatsapp: "whatsapp",
  discord: "discord"
});

const DISCORD_TARGET_LIMIT = 200;
const DELIVERY_ROW_LIMIT = 200;

export function emptyNotificationPreferences() {
  return {
    available: false,
    supported: false,
    channels: { in_app: true, sms: false, whatsapp: false, discord: false },
    smsNumber: "",
    smsNumberVerified: false,
    smsNumberVerifiedAt: "",
    discordTarget: "",
    discordTargetVerified: false,
    discordTargetVerifiedAt: "",
    quietHours: null,
    timezone: "",
    utcOffsetMinutes: null,
    // Channels the connected Platform reports it can deliver. WhatsApp and Discord arrive with a
    // later platform update; until the server lists them they are "coming" rather than "off".
    platformChannels: { in_app: true, sms: true, whatsapp: false, discord: false },
    error: ""
  };
}

/**
 * Normalize a get_notification_preferences / set_notification_preferences /
 * verify_notification_phone payload. Missing fields mean "not configured", never "verified".
 */
export function normalizeNotificationPreferences(payload) {
  const base = emptyNotificationPreferences();
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const prefs = source.preferences && typeof source.preferences === "object" && !Array.isArray(source.preferences)
    ? source.preferences
    : source;
  const channels = prefs.channels && typeof prefs.channels === "object" && !Array.isArray(prefs.channels)
    ? prefs.channels
    : {};
  const available = Array.isArray(source.channels_available)
    ? source.channels_available.map((entry) => String(entry || "").toLowerCase())
    : [];
  const listed = (name) => available.includes(name);
  const smsNumberVerifiedAt = safeTimestamp(prefs.sms_number_verified_at ?? prefs.smsNumberVerifiedAt);
  const discordTargetVerifiedAt = safeTimestamp(prefs.discord_target_verified_at ?? prefs.discordTargetVerifiedAt);
  const smsNumber = boundedText(prefs.sms_number ?? prefs.smsNumber, 40);
  const discordTarget = boundedText(prefs.discord_target ?? prefs.discordTarget, DISCORD_TARGET_LIMIT);
  const quiet = prefs.quiet_hours ?? prefs.quietHours;
  const quietHours = quiet && typeof quiet === "object" && isClock(quiet.start) && isClock(quiet.end)
    ? { start: String(quiet.start), end: String(quiet.end) }
    : null;
  const offset = Number(prefs.utc_offset_minutes ?? prefs.utcOffsetMinutes);
  return {
    ...base,
    available: true,
    supported: true,
    channels: {
      in_app: channels[PREFERENCE_CHANNEL_KEYS.in_app] !== false,
      sms: channels.sms === true,
      whatsapp: channels.whatsapp === true,
      discord: channels.discord === true
    },
    smsNumber,
    smsNumberVerified: Boolean(smsNumber) &&
      (prefs.sms_number_verified === true || prefs.smsNumberVerified === true || Boolean(smsNumberVerifiedAt)),
    smsNumberVerifiedAt,
    discordTarget,
    discordTargetVerified: Boolean(discordTarget) &&
      (prefs.discord_target_verified === true || prefs.discordTargetVerified === true || Boolean(discordTargetVerifiedAt)),
    discordTargetVerifiedAt,
    quietHours,
    timezone: boundedText(prefs.timezone, 64),
    utcOffsetMinutes: Number.isInteger(offset) && Math.abs(offset) <= 840 ? offset : null,
    platformChannels: {
      in_app: true,
      sms: available.length === 0 || listed("sms"),
      // Only a server that lists the channel can deliver it; a flag alone is not enough.
      whatsapp: listed("whatsapp"),
      discord: listed("discord")
    }
  };
}

/**
 * Whether one channel may be chosen for a Mission right now, with the plain-English reason and
 * whether Settings can fix it (setup) or only a platform update can (coming).
 */
export function channelAvailability(channel, preferences) {
  const prefs = preferences && typeof preferences === "object" ? preferences : emptyNotificationPreferences();
  switch (channel) {
    case "in_app":
      return { configured: true, reason: "", fix: "" };
    case "sms":
      if (!prefs.available) return { configured: false, reason: "Connect your AMOS company to text Mission updates.", fix: "connect" };
      if (!prefs.platformChannels?.sms) return { configured: false, reason: "SMS delivery is not enabled for this company.", fix: "coming" };
      if (!prefs.smsNumber) return { configured: false, reason: "Add a phone number.", fix: "setup" };
      if (!prefs.smsNumberVerified) return { configured: false, reason: "Verify your phone number.", fix: "setup" };
      return { configured: true, reason: "", fix: "" };
    case "whatsapp":
      if (!prefs.available) return { configured: false, reason: "Connect your AMOS company to send WhatsApp updates.", fix: "connect" };
      if (!prefs.platformChannels?.whatsapp) return { configured: false, reason: "Coming with the platform update.", fix: "coming" };
      if (!prefs.smsNumber) return { configured: false, reason: "Add a phone number.", fix: "setup" };
      if (!prefs.smsNumberVerified) return { configured: false, reason: "Verify your phone number.", fix: "setup" };
      return { configured: true, reason: "", fix: "" };
    case "discord":
      if (!prefs.available) return { configured: false, reason: "Connect your AMOS company to send Discord updates.", fix: "connect" };
      if (!prefs.platformChannels?.discord) return { configured: false, reason: "Coming with the platform update.", fix: "coming" };
      if (!prefs.discordTarget) return { configured: false, reason: "Add a Discord target.", fix: "setup" };
      if (!prefs.discordTargetVerified) return { configured: false, reason: "Verify your Discord target.", fix: "setup" };
      return { configured: true, reason: "", fix: "" };
    default:
      return { configured: false, reason: "Unknown channel.", fix: "" };
  }
}

/** The channels a new Mission starts with: In-app always, plus every enabled, configured channel. */
export function defaultMissionChannels(preferences) {
  const prefs = preferences && typeof preferences === "object" ? preferences : emptyNotificationPreferences();
  const channels = ["in_app"];
  for (const channel of ["sms", "whatsapp", "discord"]) {
    if (prefs.channels?.[channel] === true && channelAvailability(channel, prefs).configured) channels.push(channel);
  }
  return channels;
}

/**
 * Bound a Mission's channel choice to the platform contract:
 * `{ channels: ["in_app" | "sms" | "whatsapp" | "discord"], discord_target?: string }`.
 * Returns null when nothing usable was supplied.
 */
export function normalizeMissionNotificationChoice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = Array.isArray(value.channels)
    ? value.channels
    : Array.isArray(value.notification_channels)
      ? value.notification_channels
      : [];
  const channels = [];
  for (const entry of raw) {
    const channel = String(entry || "").trim().toLowerCase().replaceAll("-", "_");
    const known = channel === "desktop_inapp" || channel === "inapp" ? "in_app" : channel;
    if (MISSION_NOTIFICATION_CHANNELS.includes(known) && !channels.includes(known)) channels.push(known);
  }
  if (channels.length === 0) return null;
  const target = boundedText(value.discord_target ?? value.discordTarget, DISCORD_TARGET_LIMIT);
  return channels.includes("discord") && target
    ? { channels, discord_target: target }
    : { channels };
}

/**
 * Validate the choice a user made for a new Mission. Every chosen channel must be set up and
 * verified for this user; otherwise the Mission is refused with a Settings pointer rather than
 * created with a channel that would silently never deliver.
 */
export function assertMissionChannelsConfigured(choice, preferences) {
  const normalized = normalizeMissionNotificationChoice(choice);
  if (!normalized) throw new Error("Choose at least one place to send Mission updates");
  const blocked = normalized.channels
    .map((channel) => [channel, channelAvailability(channel, preferences)])
    .filter(([, availability]) => !availability.configured);
  if (blocked.length === 0) return normalized;
  const detail = blocked
    .map(([channel, availability]) => `${MISSION_CHANNEL_LABELS[channel]}: ${availability.reason}`)
    .join(" ");
  const settings = blocked.some(([, availability]) => availability.fix === "setup");
  throw new Error(
    `${detail}${settings ? " Set it up in Settings → Notifications, then create the Mission." : ""}`.trim()
  );
}

/** "In-app, SMS" */
export function missionChannelsLabel(choice) {
  const normalized = normalizeMissionNotificationChoice(choice);
  if (!normalized) return "";
  return normalized.channels.map((channel) => MISSION_CHANNEL_LABELS[channel] || channel).join(", ");
}

/**
 * True when the user has told AMOS where Mission updates should go: an external channel that is
 * enabled and verified, or quiet hours. A bare in-app default is not a saved preference, so a
 * chat-created Mission asks once.
 */
export function hasSavedNotificationPreference(preferences) {
  const prefs = preferences && typeof preferences === "object" ? preferences : null;
  if (!prefs?.available) return false;
  if (prefs.quietHours) return true;
  return ["sms", "whatsapp", "discord"].some((channel) =>
    prefs.channels?.[channel] === true && channelAvailability(channel, prefs).configured
  );
}

/** Per-channel delivery evidence from list_mission_notifications (or an embedded notification_delivery). */
export function normalizeMissionNotificationDelivery(rows) {
  if (!Array.isArray(rows)) return [];
  const delivery = [];
  for (const row of rows.slice(0, DELIVERY_ROW_LIMIT)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const channel = String(row.channel || "").trim().toLowerCase();
    if (!channel) continue;
    delivery.push({
      id: boundedText(row.id, 160),
      channel: channel === "desktop_inapp" ? "in_app" : channel,
      eventKind: boundedText(row.event_kind ?? row.eventKind, 80),
      status: boundedText(row.status, 40) || "pending",
      attempts: Number.isInteger(Number(row.attempts)) ? Number(row.attempts) : 0,
      deliveredAt: safeTimestamp(row.delivered_at ?? row.deliveredAt),
      acknowledgedAt: safeTimestamp(row.acknowledged_at ?? row.acknowledgedAt),
      lastError: boundedText(row.last_error ?? row.lastError, 600),
      createdAt: safeTimestamp(row.created_at ?? row.createdAt)
    });
  }
  return delivery;
}

/** Arguments for set_notification_preferences; only the keys the user actually changed are sent. */
export function notificationPreferenceArgs(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const args = {};
  if (source.channels && typeof source.channels === "object" && !Array.isArray(source.channels)) {
    const channels = {};
    for (const [channel, key] of Object.entries(PREFERENCE_CHANNEL_KEYS)) {
      const value = source.channels[channel] ?? source.channels[key];
      if (typeof value === "boolean") channels[key] = value;
    }
    if (Object.keys(channels).length > 0) args.channels = channels;
  }
  if ("quietHours" in source || "quiet_hours" in source) {
    const quiet = "quietHours" in source ? source.quietHours : source.quiet_hours;
    if (quiet === null || quiet === undefined || quiet === "") {
      args.quiet_hours = null;
    } else if (quiet && typeof quiet === "object" && isClock(quiet.start) && isClock(quiet.end)) {
      if (quiet.start === quiet.end) throw new Error("Quiet hours need two different times");
      args.quiet_hours = { start: String(quiet.start), end: String(quiet.end) };
    } else {
      throw new Error("Quiet hours must be two HH:MM times, or empty to clear them");
    }
  }
  const offset = Number(source.utcOffsetMinutes ?? source.utc_offset_minutes);
  if (Number.isInteger(offset) && Math.abs(offset) <= 840) args.utc_offset_minutes = offset;
  if ("timezone" in source) {
    const timezone = boundedText(source.timezone, 64);
    args.timezone = timezone || null;
  }
  if ("smsNumber" in source || "sms_number" in source) {
    const number = String(source.smsNumber ?? source.sms_number ?? "").replaceAll(/[\s().-]/g, "");
    if (!number) {
      args.sms_number = null;
    } else if (!/^\+[1-9]\d{6,14}$/.test(number)) {
      throw new Error("Enter the phone number in international format, like +15551234567");
    } else {
      args.sms_number = number;
    }
  }
  if ("discordTarget" in source || "discord_target" in source) {
    const target = boundedText(source.discordTarget ?? source.discord_target, DISCORD_TARGET_LIMIT);
    args.discord_target = target || null;
  }
  return args;
}

function isClock(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function boundedText(value, limit) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, limit);
}

function safeTimestamp(value) {
  if (!value) return "";
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}
