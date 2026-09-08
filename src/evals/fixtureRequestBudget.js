// Process-local research admission/accounting. A controller shares one instance
// across every scored and auxiliary request; it supplies the actual tokenizer.
// This does not dispatch work, monitor serving load or persist a restart ledger.
export function createFixtureRequestBudget({
  maxHttpCalls, maxTotalTokens, maxInputTokensPerRequest, maxConcurrentRequests
}) {
  const limits = { maxHttpCalls, maxTotalTokens, maxInputTokensPerRequest, maxConcurrentRequests };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Positive integer required: ${name}`);
  }
  const abort = new AbortController();
  let httpCalls = 0, activeRequests = 0, chargedTokens = 0, reservedTokens = 0, unknownUsageCalls = 0;
  const close = reason => { if (!abort.signal.aborted) abort.abort(String(reason)); };
  const reject = reason => { close(reason); throw new Error(reason); };
  const snapshot = () => ({
    limits: { ...limits }, httpCalls, activeRequests, chargedTokens, reservedTokens, unknownUsageCalls,
    closed: abort.signal.aborted, stopReason: abort.signal.aborted ? abort.signal.reason : null
  });
  return Object.freeze({
    signal: abort.signal, close, snapshot,
    reserve({ inputTokens, maxOutputTokens }) {
      if (abort.signal.aborted) throw new Error(abort.signal.reason);
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
          !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
          !Number.isSafeInteger(inputTokens + maxOutputTokens)) return reject("invalid_token_reservation");
      if (inputTokens > limits.maxInputTokensPerRequest) return reject("input_token_limit");
      if (httpCalls >= limits.maxHttpCalls) return reject("aggregate_http_limit");
      if (activeRequests >= limits.maxConcurrentRequests) return reject("aggregate_concurrency_limit");
      const amount = inputTokens + maxOutputTokens;
      if (amount > limits.maxTotalTokens - chargedTokens - reservedTokens) return reject("aggregate_token_limit");
      const id = ++httpCalls;
      activeRequests++;
      reservedTokens += amount;
      let receipt = null;
      return Object.freeze({
        id, inputTokens, maxOutputTokens, reservedTokens: amount,
        // Missing/partial usage consumes the entire reservation. A second
        // completion cannot refund twice or replace the original receipt.
        complete(usage = null) {
          if (receipt) return structuredClone(receipt);
          const known = Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens >= 0 &&
            Number.isSafeInteger(usage?.outputTokens) && usage.outputTokens >= 0 &&
            Number.isSafeInteger(usage.inputTokens + usage.outputTokens);
          const mismatch = known && usage.inputTokens !== inputTokens;
          const outputExceeded = known && usage.outputTokens > maxOutputTokens;
          const reported = known ? usage.inputTokens + usage.outputTokens : null;
          const charged = !known ? amount : mismatch || outputExceeded ? Math.max(amount, reported) : reported;
          activeRequests--;
          reservedTokens -= amount;
          chargedTokens += charged;
          if (!known) unknownUsageCalls++;
          // A server/tokenizer disagreement is observed after dispatch. Preserve
          // that fact and stop future work; do not conceal it by refunding space.
          if (mismatch) close("input_token_count_mismatch");
          if (outputExceeded) close("reported_output_token_limit");
          if (chargedTokens + reservedTokens > limits.maxTotalTokens) close("reported_aggregate_token_limit");
          receipt = {
            id, inputTokens, maxOutputTokens, reservedTokens: amount, chargedTokens: charged,
            usageKnown: known, reportedUsage: known ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null
          };
          return structuredClone(receipt);
        }
      });
    }
  });
}
