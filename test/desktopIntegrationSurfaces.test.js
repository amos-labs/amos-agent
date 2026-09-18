import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_SNAPSHOT_SURFACES,
  INTEGRATION_SURFACES,
  isExtraSurfaceKey,
  normalizeDesktopSnapshot
} from "../src/desktop/remoteState.js";
import { CHANGE_STREAM_SURFACES } from "../src/desktop/changeStream.js";

const surface = (key, label, extra = {}) => ({
  label,
  available: true,
  locked: null,
  read: true,
  status: "available",
  version: `${key}-v1`,
  unchanged: false,
  ...extra
});

function snapshot() {
  return {
    contract_version: 1,
    snapshot_version: "snap-9",
    generated_at: "2026-09-18T15:00:00.000Z",
    client: { principal_type: "user", role: "owner" },
    surfaces: {
      automations: surface("automations", "Automations"),
      pipelines: surface("pipelines", "Pipelines"),
      jobs: surface("jobs", "Integration jobs"),
      webhooks: surface("webhooks", "Webhooks", {
        available: false,
        locked: { reason: "capability_disabled", detail: "integrations" }
      }),
      // A surface this client has never heard of: the platform describes it
      // and ships its manifest, so it must flow through untouched.
      ledgers: surface("ledgers", "Ledgers"),
      "Bad Key!": surface("bad", "Ignored")
    },
    sections: {
      pipelines: {
        version: "pipelines-v1",
        status: "available",
        data: {
          list_integration_pipelines: {
            pipelines: [
              { id: "p1", key: "conductor-disputes", status: "active", version: 3 },
              { id: "p2", key: "nightly", status: "paused", version: 1 }
            ]
          }
        }
      },
      jobs: {
        version: "jobs-v1",
        status: "available",
        data: { list_integration_jobs: { jobs: [{ id: "j1", status: "running", records_in: 40 }] } }
      },
      ledgers: {
        version: "ledgers-v1",
        status: "available",
        data: { list_ledgers: { ledgers: [{ id: "l1", name: "Operating" }] } }
      }
    },
    resume: { since: { pipelines: "pipelines-v1", jobs: "jobs-v1", ledgers: "ledgers-v1" } }
  };
}

test("the integrations surfaces are part of the snapshot and change-stream contracts", () => {
  for (const key of INTEGRATION_SURFACES) {
    assert.ok(DESKTOP_SNAPSHOT_SURFACES.includes(key), `${key} in snapshot surfaces`);
    assert.ok(CHANGE_STREAM_SURFACES.includes(key), `${key} in change-stream surfaces`);
  }
  assert.deepEqual([...INTEGRATION_SURFACES], ["pipelines", "jobs", "webhooks", "mappings"]);
  // The Integrations view keys are not "extra": they have a dedicated view.
  assert.equal(isExtraSurfaceKey("pipelines"), false);
  assert.equal(isExtraSurfaceKey("ledgers"), true);
  assert.equal(isExtraSurfaceKey("Bad Key!"), false);
});

test("normalizeDesktopSnapshot carries integrations sections and unknown surfaces to the generic view", () => {
  const normalized = normalizeDesktopSnapshot(snapshot());
  // Known integrations surfaces: availability + raw capability results by verb.
  assert.equal(normalized.surfaces.pipelines.available, true);
  assert.equal(
    normalized.sections.pipelines.raw.list_integration_pipelines.pipelines.length,
    2
  );
  assert.equal(normalized.sections.jobs.raw.list_integration_jobs.jobs[0].status, "running");
  // A locked surface keeps the platform's reason so the view can explain itself.
  assert.equal(normalized.surfaces.webhooks.available, false);
  assert.equal(normalized.surfaces.webhooks.locked.reason, "capability_disabled");
  // An unknown surface flows through with its section; a malformed key does not.
  assert.equal(normalized.surfaces.ledgers.available, true);
  assert.equal(normalized.sections.ledgers.raw.list_ledgers.ledgers[0].name, "Operating");
  assert.equal("Bad Key!" in normalized.surfaces, false);
  // Resume versions are kept per surface, including the unknown one.
  assert.equal(normalized.since.ledgers, "ledgers-v1");
});
