// Research-only monitoring for a controller that shares one request budget.
// Await startup before dispatch. The caller supplies primary-traffic telemetry;
// this module does not discover credentials, sample model calls, or authorize a run.
export async function startFixtureRunGuard({
  requestBudget, loadProbe, loadSource, limits, signal = null
}) {
  if (typeof requestBudget?.close !== "function" ||
      !(requestBudget?.signal instanceof AbortSignal) ||
      typeof loadProbe !== "function" || typeof loadSource !== "string" || !loadSource.trim() ||
      (signal !== null && !(signal instanceof AbortSignal))) {
    throw new Error("Provide a shared request budget and an identified load probe");
  }
  const bounds = {};
  for (const name of ["maxWallMs", "pollIntervalMs", "readTimeoutMs", "maxSampleAgeMs", "sampleWindowMs", "minSamples"]) {
    const value = limits?.[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`Positive bounded integer required: ${name}`);
    }
    bounds[name] = value;
  }
  if (!Number.isFinite(limits?.maxP95IncreaseRatio) || limits.maxP95IncreaseRatio < 0) {
    throw new Error("Nonnegative finite maxP95IncreaseRatio required");
  }
  bounds.maxP95IncreaseRatio = limits.maxP95IncreaseRatio;
  const startedAt = new Date().toISOString(), started = performance.now();
  let state = "preflight", baseline = null, latest = null, probeCount = 0;
  let stopReason = null, stoppedWallMs = null, pollTimer = null, wallTimer = null, freshnessTimer = null;

  const onExternalAbort = () => stop("external_abort");
  const onBudgetAbort = () => {
    if (state === "stopped") return;
    state = "stopped";
    stoppedWallMs = performance.now() - started;
    stopReason = String(requestBudget.signal.reason);
    clearTimeout(pollTimer);
    clearTimeout(wallTimer);
    clearTimeout(freshnessTimer);
    signal?.removeEventListener("abort", onExternalAbort);
    requestBudget.signal.removeEventListener("abort", onBudgetAbort);
  };
  const stop = reason => {
    requestBudget.close(reason);
    onBudgetAbort();
  };
  const handle = Object.freeze({
    signal: requestBudget.signal,
    // Closing the monitor also closes admission; stopping observation must not
    // leave later requests able to run without the guard. This is not a verdict.
    stop: () => stop("run_guard_stopped"),
    snapshot: () => structuredClone({
      state, startedAt, wallMs: stoppedWallMs ?? performance.now() - started,
      stopReason, loadSource, limits: bounds, probeCount, baseline, latest
    })
  });

  const validateSample = sample => {
    if (!sample || sample.source !== loadSource ||
        !Number.isSafeInteger(sample.windowStartMs) || !Number.isSafeInteger(sample.windowEndMs) ||
        sample.windowStartMs < 0 || sample.windowEndMs > Date.now() ||
        sample.windowEndMs - sample.windowStartMs !== bounds.sampleWindowMs ||
        !Number.isSafeInteger(sample.sampleCount) || sample.sampleCount < 0 ||
        !Number.isSafeInteger(sample.http5xxCount) || sample.http5xxCount < 0 ||
        sample.http5xxCount > sample.sampleCount ||
        !Number.isFinite(sample.p95Ms) || sample.p95Ms <= 0) return "invalid_load_sample";
    if (Date.now() - sample.windowEndMs > bounds.maxSampleAgeMs) return "stale_load_sample";
    if (latest && sample.windowEndMs < latest.windowEndMs) return "load_sample_time_regressed";
    if (sample.sampleCount < bounds.minSamples) return "insufficient_load_samples";
    if (sample.http5xxCount > 0) return "primary_traffic_5xx";
    if (baseline && sample.p95Ms > baseline.p95Ms * (1 + bounds.maxP95IncreaseRatio)) return "primary_latency_limit";
    return null;
  };

  const readSample = async () => {
    const readAbort = new AbortController();
    const readSignal = AbortSignal.any([requestBudget.signal, readAbort.signal]);
    let timeout = null, onAbort = null;
    try {
      if (readSignal.aborted) throw new Error("run_guard_stopped");
      probeCount++;
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(new Error(readAbort.signal.aborted ? "load_probe_timeout" : "run_guard_stopped"));
        readSignal.addEventListener("abort", onAbort, { once: true });
        timeout = setTimeout(() => readAbort.abort(), bounds.readTimeoutMs);
      });
      // A non-cooperative probe cannot keep the controller waiting past its
      // deadline. Its signal is also canceled so cooperative I/O can release.
      return await Promise.race([
        Promise.resolve().then(() => {
          if (readSignal.aborted) throw new Error("run_guard_stopped");
          return loadProbe({ signal: readSignal, windowMs: bounds.sampleWindowMs });
        }),
        interrupted
      ]);
    } finally {
      clearTimeout(timeout);
      readSignal.removeEventListener("abort", onAbort);
    }
  };

  const observe = async () => {
    if (requestBudget.signal.aborted) return;
    try {
      const sample = await readSample();
      if (requestBudget.signal.aborted) return;
      if (performance.now() - started >= bounds.maxWallMs) return stop("aggregate_wall_limit");
      const problem = validateSample(sample);
      // Retain only the metric contract, never caller payloads/traffic content.
      if (sample?.source === loadSource) latest = {
        source: sample.source, windowStartMs: sample.windowStartMs, windowEndMs: sample.windowEndMs,
        sampleCount: sample.sampleCount, p95Ms: sample.p95Ms, http5xxCount: sample.http5xxCount
      };
      if (problem) return stop(problem);
      if (!baseline) baseline = structuredClone(latest);
      state = "monitoring";
      clearTimeout(freshnessTimer);
      // Expiry also applies between polls and while a later probe is pending.
      // Repeated cached samples do not extend the original metric's validity.
      freshnessTimer = setTimeout(() => stop("stale_load_sample"),
        Math.max(1, bounds.maxSampleAgeMs - (Date.now() - latest.windowEndMs) + 1));
      pollTimer = setTimeout(observe, bounds.pollIntervalMs);
    } catch (error) {
      if (!requestBudget.signal.aborted) stop(error?.message === "load_probe_timeout" ? "load_probe_timeout" : "load_probe_failed");
    }
  };

  requestBudget.signal.addEventListener("abort", onBudgetAbort, { once: true });
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (requestBudget.signal.aborted) onBudgetAbort();
  else if (signal?.aborted) onExternalAbort();
  else {
    // Includes baseline acquisition, every probe and all model/tool/verifier
    // time. Per-fixture timers alone cannot enforce this aggregate ceiling.
    wallTimer = setTimeout(() => stop("aggregate_wall_limit"), bounds.maxWallMs);
    await observe();
  }
  return handle;
}
