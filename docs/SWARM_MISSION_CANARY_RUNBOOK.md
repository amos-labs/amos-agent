# Private Swarm Mission canary runbook

This canary changes only the checker-native Mission planner. Normal Hosted
Qwen traffic remains on private vLLM port 8000. The Swarm gateway listens on
private port 18081, accepts the existing Qwen bearer token, and calls vLLM on
instance loopback. Platform retains execution and verification authority.

## Safety contract

- Do not apply while the Qwen cell is under material interactive load.
- The Terraform plan must contain no delete action for the inference EC2
  instance. `plan-swarm-canary.sh` enforces this.
- Build and address the gateway image by immutable ECR digest.
- Allow port 18081 only from the Platform ECS security group.
- Route only the AMOS-owned tenant through the Swarm canary variables.
- Start with a bounded mission that cannot send outreach or mutate an external
  system.
- Missing or partial checker evidence is `unknown`, never success.

## Prepare before the window

1. Merge the Agent gateway-infrastructure PR and the Platform tenant-canary PR.
2. Run `build-swarm-gateway-image.sh --load` and the focused gateway tests.
3. Apply only the new ECR repository if it does not yet exist, then run
   `build-swarm-gateway-image.sh --push` and place its immutable digest in the
   private Terraform variables file.
4. Set `swarm_gateway_enabled = true` in that private variables file.
5. Generate the saved plan with `plan-swarm-canary.sh`. Reject any plan that
   changes the GPU instance, vLLM image, model volume, or port 8000 service.

## Evening activation

1. Confirm the Qwen queue and interactive traffic are quiet.
2. Apply only the reviewed saved plan. The SSM association installs and starts
   `amos-swarm-gateway.service`; it does not restart `amos-qwen.service`.
3. Run `verify-swarm-gateway.sh`. It requires both services to be active and
   confirms `/health` reports the exact Mission protocol, model, 64k backend
   context, and Platform-owned verifier.
4. Deploy the Platform canary environment. Non-canary tenants continue to use
   direct Qwen.
5. Run one AMOS-owned read-only mission with a deterministic completion checker.
6. Verify one contract-correlated gateway trace, one Platform verification
   receipt, and no replayed tool action.
7. Export the terminal Mission under an explicit internal-authorized data
   policy and collect it into the organism learning store.

## Rollback

First remove the Platform canary environment override so new Mission turns use
direct Qwen. Then run `rollback-swarm-gateway.sh`; it stops only the gateway
service and leaves vLLM running. If a Mission is in progress, pause it before
rollback and resume from its last immutable checkpoint after routing is direct.

Abort the canary on any authentication failure, unavailable health check,
malformed Mission plan after the single recovery pass, unknown verification,
unexpected external effect, or material increase in direct-Qwen latency.
