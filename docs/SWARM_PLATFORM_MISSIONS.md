# Swarm OS as an AMOS Mission worker

Swarm OS can serve as the planning intelligence for checker-native AMOS
Missions without becoming the authority for execution or success. The stable
boundary is deliberately narrow:

```text
AMOS Platform Run Contract
    -> private OpenAI-compatible Swarm gateway
        -> shared Qwen backbone and logical specialists
    <- one canonical MissionPlan JSON object
AMOS Platform validates authority and executes the step
    -> pinned independent checker adapters
    -> immutable verification receipts
    -> explicitly authorized Swarm learning episode
```

This separation is the production harness for the organism. Swarm may propose
`tool`, `checkpoint`, `ask_user`, `verify`, or `fail`; it cannot mint tool
authority, approve its own work, or convert missing verification into success.

## Worker protocol

The gateway recognizes only the exact Platform planner envelope
`amos-mission-worker:2026-09-06`. Ordinary chat remains ordinary chat. For a
Mission request it:

1. correlates every private deliberation trace with the mission and immutable
   contract;
2. runs logical specialists over one shared Qwen endpoint;
3. canonicalizes the final response to the Platform's `MissionPlan` schema;
4. performs at most one format-recovery call when the model emits malformed
   JSON, with tools removed so no action can be replayed; and
5. returns only the plan. Platform still validates allowed operations,
   budgets, decisions, checkpoints, and completion.

The `/health` response advertises both the protocol version and the authority
split. Point Platform at the private gateway with:

```text
AMOS__MISSIONS__INTELLIGENCE_BASE_URL=http://<private-swarm-gateway>:18081/v1
AMOS__MISSIONS__INTELLIGENCE_MODEL=amos-qwen38-27b-fp8
```

The gateway must be reachable only from Platform, authenticate every request,
and call the Qwen endpoint over the private VPC path. The no-ingress research
runner remains a queued research and training worker; it is not the production
gateway.

## Checker receipts become organism experience

After a Mission reaches a terminal state, export its `get_mission` result and
the corresponding gateway JSONL traces. A data owner must also provide an
explicit policy; customer data is never silently opted into research or
training.

```json
{
  "sourceClass": "internal-authorized",
  "permittedUses": ["research", "training"],
  "trainingApproved": true,
  "contaminationTags": ["amos-owned-mission"]
}
```

Collect the immutable episode with:

```bash
node scripts/collectPlatformMissionEpisode.js \
  --mission /secure/get-mission.json \
  --traces /secure/swarm-gateway.jsonl \
  --data-policy /secure/data-policy.json \
  --store /secure/swarm-learning \
  --output /secure/collection-receipt.json
```

Only complete, correctly pinned checker coverage can create a verified pass.
A checker failure creates verified negative experience. Missing, unknown,
under-authority, mismatched, or partial evidence creates an execution-error
episode that is useful for organism policy learning but is ineligible as
positive adapter-training data.

## Harbor's role

Harbor remains an unchanged independent benchmark. It is not the AMOS
production verifier and its missing reward must never be synthesized. A Harbor
run with a qualified candidate-evolution chain but no official reward remains
`official-verifier-coverage-incomplete`. The Platform checker waist lets the
organism learn from real AMOS work while that independent harness problem is
diagnosed separately.

## Rollout gates

1. Merge and deploy the checker-native Platform implementation.
2. Deploy this gateway behind private authenticated networking.
3. Configure Platform's Mission intelligence URL and model.
4. Enable Missions for one AMOS-owned tenant and one bounded, reversible
   pilot Mission.
5. Confirm the gateway emits a contract-correlated trace and Platform accepts
   the canonical plan.
6. Confirm the Platform—not Swarm—executes the action and records pinned
   checker evidence.
7. Collect the terminal Mission into the learning store under an explicit data
   policy and replay it through the organism's normal promotion gates.

Direct Qwen and frontier providers remain valid controls. Swarm becomes a
production intelligence candidate only after it improves verified mission
outcomes without increasing unknown checks, unsafe proposals, cost, or
recovery rate.
