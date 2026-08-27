const MAX_JOBS = 12;
const MAX_TITLE = 220;
const MAX_NOTE = 600;
const MAX_NOTES = 1_500;
const MAX_CURRENT = 1_500;
const MAX_OPEN_LOOPS = 8;
const MAX_LOOP = 280;
const JOB_STATUSES = new Set(["open", "current", "parked", "done"]);

export function emptyScratchpad() {
  return {
    currentJob: "",
    jobs: [],
    openLoops: [],
    notes: "",
    updatedAt: null
  };
}

export function scratchpadHasWork(value) {
  const pad = value && typeof value === "object" ? value : {};
  return Boolean(
    String(pad.currentJob || "").trim()
    || String(pad.notes || "").trim()
    || (Array.isArray(pad.jobs) && pad.jobs.some((job) => String(job?.title || "").trim()))
    || (Array.isArray(pad.openLoops) && pad.openLoops.some((item) => String(item || "").trim()))
  );
}

export function normalizeScratchpad(value = {}, { redact = identity } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const usedIds = new Set();
  const jobs = (Array.isArray(source.jobs) ? source.jobs : [])
    .flatMap((job) => {
      if (!job || typeof job !== "object" || Array.isArray(job)) return [];
      const title = redact(cleanText(job.title, MAX_TITLE));
      if (!title) return [];
      const id = ensureJobId(job.id, title, usedIds);
      usedIds.add(id);
      return [{
        id,
        title,
        status: JOB_STATUSES.has(job.status) ? job.status : "open",
        note: redact(cleanText(job.note, MAX_NOTE))
      }];
    })
    .slice(-MAX_JOBS);
  return {
    currentJob: redact(cleanText(source.currentJob, MAX_CURRENT)),
    jobs,
    openLoops: uniqueText(source.openLoops, MAX_OPEN_LOOPS, MAX_LOOP, redact),
    notes: redact(cleanText(source.notes, MAX_NOTES)),
    updatedAt: optionalTimestamp(source.updatedAt)
  };
}

export function applyScratchpadPatch(pad, patch = {}, { now = () => new Date(), createId = createJobId } = {}) {
  const next = normalizeScratchpad(pad);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const currentJob = source.current_job ?? source.currentJob;
  if (currentJob != null && String(currentJob).trim()) {
    Object.assign(next, syncScratchpadWithObjective(next, currentJob, {
      now,
      createId,
      note: source.note,
      status: source.status
    }));
  }
  if (Array.isArray(source.jobs)) {
    for (const job of source.jobs) {
      upsertJob(next, job, { createId });
    }
  }
  if (source.add_job) upsertJob(next, source.add_job, { createId });
  if (source.update_job) upsertJob(next, source.update_job, { createId });
  if (source.notes != null) next.notes = cleanText(source.notes, MAX_NOTES);
  if (Array.isArray(source.open_loops) || Array.isArray(source.openLoops)) {
    next.openLoops = uniqueText(source.open_loops || source.openLoops, MAX_OPEN_LOOPS, MAX_LOOP);
  }
  if (source.add_open_loop) {
    const loop = cleanText(source.add_open_loop, MAX_LOOP);
    if (loop && !next.openLoops.includes(loop)) {
      next.openLoops = [...next.openLoops, loop].slice(-MAX_OPEN_LOOPS);
    }
  }
  if (source.complete_current === true && next.currentJob) {
    upsertJob(next, { title: next.currentJob, status: "done", note: source.note }, { createId });
  }
  next.jobs = capJobs(next.jobs);
  next.updatedAt = now().toISOString();
  return normalizeScratchpad(next);
}

export function syncScratchpadWithObjective(pad, text, {
  now = () => new Date(),
  createId = createJobId,
  note = "",
  status = ""
} = {}) {
  const incoming = String(text || "").trim();
  const next = normalizeScratchpad(pad);
  if (!incoming) return next;
  const previous = String(next.currentJob || "").trim();
  if (previous && previous !== incoming) {
    upsertJob(next, { title: previous, status: "parked" }, { createId });
  }
  upsertJob(next, {
    title: incoming.slice(0, MAX_TITLE),
    status: JOB_STATUSES.has(status) ? status : "current",
    note
  }, { createId });
  next.currentJob = incoming.slice(0, MAX_CURRENT);
  next.jobs = capJobs(next.jobs);
  next.updatedAt = now().toISOString();
  return next;
}

export function resolveScratchpadView({
  scratchpad,
  workingObjective = "",
  recentJobs = []
} = {}) {
  const pad = normalizeScratchpad(scratchpad);
  const currentJob = String(pad.currentJob || workingObjective || "").trim();
  const jobs = [...pad.jobs];
  const knownTitles = new Set(jobs.map((job) => job.title.toLowerCase()));
  const usedIds = new Set(jobs.map((job) => job.id).filter(Boolean));
  for (const title of Array.isArray(recentJobs) ? recentJobs : []) {
    const text = String(title || "").trim();
    if (!text || knownTitles.has(text.toLowerCase())) continue;
    knownTitles.add(text.toLowerCase());
    const id = ensureJobId("", text, usedIds);
    usedIds.add(id);
    jobs.push({
      id,
      title: text.slice(0, MAX_TITLE),
      status: currentJob && text === currentJob ? "current" : "parked",
      note: ""
    });
  }
  if (currentJob && !jobs.some((job) => titlesMatch(job.title, currentJob))) {
    const id = ensureJobId("", currentJob, usedIds);
    jobs.push({
      id,
      title: currentJob.slice(0, MAX_TITLE),
      status: "current",
      note: ""
    });
  }
  const currentTitle = currentJob.slice(0, MAX_TITLE);
  return {
    ...pad,
    currentJob,
    jobs: capJobs(jobs.map((job) => {
      if (titlesMatch(job.title, currentTitle)) {
        return { ...job, status: job.status === "done" ? "done" : "current" };
      }
      if (job.status === "current") return { ...job, status: "parked" };
      return job;
    }))
  };
}

export function formatScratchpadCard({
  scratchpad,
  workingObjective = "",
  recentJobs = [],
  compacted = false,
  vendorSignals = ""
} = {}) {
  const view = resolveScratchpadView({ scratchpad, workingObjective, recentJobs });
  if (!scratchpadHasWork(view) && !compacted) return "";
  const jobLines = view.jobs.map((job) => {
    const note = job.note ? ` — ${job.note}` : "";
    return `- [${job.status}] ${job.title}${note}`;
  }).join("\n");
  const loops = view.openLoops.map((item) => `- ${item}`).join("\n");
  const vendorText = compacted ? String(vendorSignals || "").trim() : "";
  return [
    "<amos_scratchpad>",
    "Durable job list for THIS conversation only. It is not a Project. A conversation may have no Project. Users hop jobs in one thread; that is expected.",
    view.currentJob ? `Current job:\n${view.currentJob.slice(0, 1_200)}` : "Current job: (not yet stated)",
    jobLines ? `Jobs:\n${jobLines}` : "",
    loops ? `Open loops:\n${loops}` : "",
    view.notes ? `Notes:\n${view.notes}` : "",
    compacted
      ? "Older turns were omitted to fit the model window. Call desktop_inspect_conversation with a word from an earlier job to recover exact messages. Do not invent a different job."
      : "Keep this pad current with desktop_update_scratchpad when the user hops jobs. Call desktop_inspect_conversation for exact quotes.",
    vendorText,
    "</amos_scratchpad>"
  ].filter(Boolean).join("\n");
}

export function createScratchpadTools({ getPad, setPad }) {
  return [
    {
      name: "desktop_read_scratchpad",
      source: "desktop",
      toolkit: "core",
      readOnly: true,
      parallelSafe: true,
      description:
        "Read this conversation's durable job pad: current job, parked jobs, open loops, and notes. This pad belongs to the conversation, not a Project. Use it before inventing a different task. Exact quotes still come from desktop_inspect_conversation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {}
      },
      handler() {
        return {
          ok: true,
          scratchpad: normalizeScratchpad(typeof getPad === "function" ? getPad() : getPad)
        };
      }
    },
    {
      name: "desktop_update_scratchpad",
      source: "desktop",
      toolkit: "core",
      description:
        "Update this conversation's durable job pad without waiting for approval. Use when the user hops jobs (integration → QBO → Stripe tax), parks unfinished work, or leaves an open loop. Do not store secrets, credentials, or replayable tool arguments.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          current_job: {
            type: "string",
            maxLength: MAX_CURRENT,
            description: "The job being worked now. Parks the previous current job."
          },
          note: {
            type: "string",
            maxLength: MAX_NOTE,
            description: "Short note for the current job."
          },
          status: {
            type: "string",
            enum: [...JOB_STATUSES],
            description: "Status to apply to the current job."
          },
          notes: {
            type: "string",
            maxLength: MAX_NOTES,
            description: "Replace the pad-level notes."
          },
          open_loops: {
            type: "array",
            maxItems: MAX_OPEN_LOOPS,
            items: { type: "string", maxLength: MAX_LOOP },
            description: "Replace the open-loop list."
          },
          add_open_loop: {
            type: "string",
            maxLength: MAX_LOOP,
            description: "Append one open loop."
          },
          add_job: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string", maxLength: MAX_TITLE },
              status: { type: "string", enum: [...JOB_STATUSES] },
              note: { type: "string", maxLength: MAX_NOTE }
            }
          },
          update_job: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", maxLength: 64 },
              title: { type: "string", maxLength: MAX_TITLE },
              status: { type: "string", enum: [...JOB_STATUSES] },
              note: { type: "string", maxLength: MAX_NOTE }
            }
          },
          jobs: {
            type: "array",
            maxItems: MAX_JOBS,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", maxLength: 64 },
                title: { type: "string", maxLength: MAX_TITLE },
                status: { type: "string", enum: [...JOB_STATUSES] },
                note: { type: "string", maxLength: MAX_NOTE }
              }
            }
          },
          complete_current: {
            type: "boolean",
            description: "Mark the current job done."
          }
        }
      },
      async handler(args = {}) {
        const current = typeof getPad === "function" ? getPad() : getPad;
        const next = applyScratchpadPatch(current, args);
        if (typeof setPad === "function") await setPad(next);
        return { ok: true, scratchpad: next };
      }
    }
  ];
}

function upsertJob(pad, job, { createId }) {
  if (!job || typeof job !== "object") return;
  const title = cleanText(job.title, MAX_TITLE);
  const id = cleanText(job.id, 64);
  if (!title && !id) return;
  const index = pad.jobs.findIndex((item) =>
    (id && item.id === id) || (title && titlesMatch(item.title, title))
  );
  const currentTitle = title || pad.jobs[index]?.title || "";
  if (!currentTitle) return;
  const status = JOB_STATUSES.has(job.status)
    ? job.status
    : (index >= 0 ? pad.jobs[index].status : "open");
  const note = job.note == null
    ? (index >= 0 ? pad.jobs[index].note : "")
    : cleanText(job.note, MAX_NOTE);
  const record = {
    id: id || pad.jobs[index]?.id || createId(currentTitle),
    title: currentTitle,
    status,
    note
  };
  if (status === "current") {
    pad.jobs = pad.jobs.map((item) => (
      item.id === record.id || titlesMatch(item.title, record.title)
        ? item
        : item.status === "current"
          ? { ...item, status: "parked" }
          : item
    ));
    pad.currentJob = currentTitle;
  }
  if (index >= 0) pad.jobs[index] = { ...pad.jobs[index], ...record };
  else pad.jobs.push(record);
}

function capJobs(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (list.length <= MAX_JOBS) return list;
  const current = list.filter((job) => job.status === "current");
  const rest = list.filter((job) => job.status !== "current");
  const keep = Math.max(0, MAX_JOBS - current.length);
  return [...rest.slice(-keep), ...current].slice(-MAX_JOBS);
}

function ensureJobId(value, title, used) {
  const requested = cleanText(value, 64);
  if (requested && !used.has(requested)) return requested;
  const base = `job-${slug(title) || "item"}`.slice(0, 64);
  let candidate = used.has(base) ? "" : base;
  if (!candidate) {
    let index = 2;
    candidate = `${base}-${index}`.slice(0, 64);
    while (used.has(candidate)) {
      index += 1;
      candidate = `${base}-${index}`.slice(0, 64);
    }
  }
  return candidate;
}

function createJobId(title) {
  return ensureJobId("", title, new Set());
}

function uniqueText(value, maxItems, maxLength, redact = identity) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => redact(cleanText(item, maxLength)))
    .filter(Boolean))]
    .slice(-maxItems);
}

function titlesMatch(left, right) {
  const a = String(left || "").trim().toLowerCase().slice(0, MAX_TITLE);
  const b = String(right || "").trim().toLowerCase().slice(0, MAX_TITLE);
  return Boolean(a) && a === b;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function optionalTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function identity(value) {
  return value;
}
