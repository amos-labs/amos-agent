# Knowledge integration results

## 2026-08-08 — GPT-OSS 20B diagnostic calibration

This run validated the version-0 harness and rejected the initial fixtures as a
useful capability benchmark.

### Configuration

- Model: official GPT-OSS 20B MXFP4 GGUF already present in the local
  ExpertCache artifact cache
- Runtime: pinned ExpertCache `llama.cpp` Metal build, OpenAI-compatible local
  server
- Context: 8,192 tokens
- Completion ceiling: 768 tokens
- Temperature: 0
- Suite: `amos.knowledge-integration-suite` version 0, diagnostic
- Cases: 6 hand-authored calibration cases
- Arms: ordinary combined-task prompt and atomic-elicitation-assisted
  integration prompt

Command shape:

```bash
npm run benchmark:integration -- gpt-oss-20b \
  --protocol openai \
  --url http://127.0.0.1:11445 \
  --arm all \
  --output REPORT.json
```

### Result

| Metric | Result |
| --- | ---: |
| Total cases | 6 |
| Cases passing every atomic probe | 6/6 |
| Baseline conditional integration accuracy | 6/6 |
| Assisted conditional integration accuracy | 6/6 |
| Observed integration failures | 0 |
| Recovered integration failures | 0 |

### Interpretation

The result does not support or refute the knowledge-integration hypothesis. It
shows that the endpoint, structured evaluator, atomic eligibility rule,
assisted prompt construction, aggregation, and latency/token capture execute
end to end. The cases are too easy for GPT-OSS 20B and cannot measure an
integration lift.

Version 0 must not be quoted as a model-quality result. It was run on one warm
local process, has only six development-visible cases, contains no paraphrase
or distractor variants, and has no stronger-model control.

### Harness corrections discovered during calibration

1. Empty numeric CLI options initially coerced to zero and reduced the
   completion allowance to 32 tokens. GPT-OSS used the allowance in its
   reasoning channel and returned empty final content. Empty values now select
   the documented default of 768 tokens.
2. Required rationale terms initially changed the primary pass/fail score even
   when the selected answer was correct. Exact answer correctness is now the
   primary deterministic score; rationale terms are reported separately as a
   diagnostic until a semantic or blinded rationale evaluator is registered.

### Next-suite admission rule

A development case advances toward the frozen benchmark only if it contributes
at least one of:

- a demonstrated atomic-pass / combined-fail pattern on a target local model;
- a longer dependency chain with an auditable intermediate-state evaluator;
- a controlled contradiction, distractor, paraphrase, or surface-transfer
  variant;
- a counterfactual whose answer changes under one isolated intervention; or
- a verified tool/workflow outcome that cannot be solved by selecting an
  obvious multiple-choice label.

The next target is 50 audited cases across at least five categories. Development
failures used to design the engine must remain separate from the later frozen
evaluation set.

## 2026-08-08 — counterfactual development pass

Version 1 added five paired families in which one isolated condition changes
the correct answer: fencing enforcement, diagnostic-test independence,
collider selection, consumer idempotency, and current policy/receipt authority.
The five base cases and five counterfactuals were run through both arms.

| Metric | Result |
| --- | ---: |
| Total combined cases | 10 |
| Cases passing every atomic probe | 8/10 |
| Baseline conditional integration accuracy | 8/8 |
| Assisted conditional integration accuracy | 8/8 |
| Baseline paired-family consistency | 5/5 |
| Assisted paired-family consistency | 4/5 |
| Atomic-eligible integration failures | 0 |

The assisted inconsistency was not a wrong final choice. Its longer prompt used
the complete 768-token allowance in the model's reasoning channel and returned
no final content on the no-fencing counterfactual. This is an integration-cost
failure and reinforces the need to measure completion budgets, retry policy,
and wall time rather than quality alone.

The two ineligible cases belonged to the same fencing family. GPT-OSS answered
that an expired-lease process could not resume and issue a write, while also
correctly answering a near-equivalent probe that lease expiry does not
physically stop paused code. The first probe has been rewritten to separate
physical possibility from authorization. The observed inconsistency remains a
useful development finding but is not promoted into the frozen score.

The second pass again found that compact, explicit multiple-choice scenarios
are too easy. The next development pool must use longer dependency structures,
distributed evidence, intermediate-state scoring, misleading but individually
true facts, and transfer to a surface form not used by the atomic probes.
