# Private AWS Qwen inference cell

This module creates the first AWS execution lane for the AMOS recursive-
intelligence program. It serves one pinned Qwen 3.8 27B FP8 checkpoint from a
single NVIDIA GPU and lets direct Qwen plus up to three logical swarm workers
share the same weights through vLLM continuous batching.

It is deliberately not a public model API:

- the instance has no public IP and its security group has no ingress rules;
- operator access uses AWS Systems Manager port forwarding;
- vLLM requires a generated bearer key stored in Secrets Manager;
- the model comes from a versioned, encrypted S3 bucket;
- the runtime comes from immutable, encrypted ECR storage by image digest;
- the instance uses IMDSv2, encrypted gp3, and a least-privilege role; and
- Terraform state uses the existing versioned, encrypted AMOS backend under a
  research-only key with DynamoDB locking; and
- no managed-platform mission, goal, approval, or lifecycle table is created.

## Qualified starting shape

| Property | Initial value |
| --- | --- |
| Region / AZ | `us-east-1` / `us-east-1b` |
| Instance | `g7e.2xlarge`, one 96 GB Blackwell GPU |
| Model | `Qwen/Qwen3.8-27B-FP8` |
| Model revision | `017b9c7af6b5689d5dd426a76e0bc077eb5ca20a` |
| Runtime | `vllm/vllm-openai:v0.27.1`, mirrored and addressed by digest |
| Context | 65,536-token Hosted product window |
| Scheduling | 8 sequences, 32,768 batched tokens, prefix cache enabled |
| Speculation | native `mtp`, three draft tokens |
| Protocol parsing | native `qwen3_xml` tool calls and `qwen3` reasoning separation |
| Endpoint | Private OpenAI-compatible API on port 8000, restricted to Platform ECS |
| Local tunnel | `http://127.0.0.1:18080` |

## Private Swarm Mission gateway

The optional gateway is a second, CPU-only container on the inference host. It
listens on private port 18081, calls Qwen through instance loopback, and exposes
the exact OpenAI-compatible contract consumed by the Platform Mission worker.
It does not own execution or verification; those remain in AMOS Platform.

The gateway is isolated from normal Hosted traffic:

- Terraform installs it with an SSM association rather than EC2 user data, so
  enabling or rolling it back does not replace the instance or restart vLLM.
- Its security-group rule admits only the Platform ECS security group.
- Its image is immutable and digest-pinned in the private gateway ECR repo.
- It reuses the existing vaulted Qwen bearer token for both inbound and
  loopback requests; the token is never written to Terraform state.
- Its trace is append-only on the inference host and contains digests and
  bounded observations rather than credentials.

Prepare the image locally without touching AWS or the live Qwen process:

```bash
./scripts/build-swarm-gateway-image.sh --load
```

The guarded activation and rollback sequence is documented in
`docs/SWARM_MISSION_CANARY_RUNBOOK.md`. `plan-swarm-canary.sh` rejects any plan
that would delete or replace the GPU instance.

The official FP8 Transformers checkpoint is a distinct artifact from the Mac
GGUF and MLX builds. It must pass the same qualification suite before any
quality or production equivalence claim. MTP verification is lossless, but its
actual acceptance rate and throughput improvement are measured rather than
assumed.

## Account qualification observed on 2026-08-22

The authenticated AMOS AWS account has 64 on-demand G/VT vCPUs in `us-east-1`.
Both `g7e.2xlarge` and `g6e.2xlarge` are offered there; G7e is offered in
`us-east-1b` and `us-east-1d`. London offers G7e hardware but the account's
current on-demand G/VT quota there is zero, so London is not the first target.

The live AWS Price List returned **$3.36312 per running g7e.2xlarge hour** in
`us-east-1` on that date. That is about $134.52 for 40 running hours,
$336.31 for 100 hours, or $2,455.08 for 730 hours, before EBS, S3, ECR, KMS,
Secrets Manager, interface endpoints, data transfer, and taxes. Re-query price
and quota before deployment. Stopping the instance stops GPU compute charges,
but storage and private endpoint charges continue. The budget is an alert, not
an automatic kill switch.

## Two-phase deployment

Do not enable the GPU until the private artifacts exist. This avoids a paid
instance sitting idle while a roughly 28-billion-parameter model downloads.

1. Copy the example variables and leave `inference_enabled = false`:

   ```bash
   cd infra/aws/qwen-inference
   cp terraform.tfvars.example terraform.tfvars
   terraform init
   terraform plan -out foundation.tfplan
   terraform apply foundation.tfplan
   ```

2. Generate the API key directly into Secrets Manager. It never enters
   Terraform state:

   ```bash
   ./scripts/initialize-api-key.sh
   ```

3. Mirror the official vLLM image into the private ECR repository:

   ```bash
   ./scripts/mirror-vllm-image.sh
   ```

   Copy the printed `vllm_image_uri` into `terraform.tfvars`.

4. Install the Hugging Face `hf` CLI if necessary, then stage the exact model
   revision. The script generates a deterministic per-file SHA-256 manifest,
   uploads the files to S3, and prints the manifest digest:

   ```bash
   ./scripts/stage-model.sh
   ```

   Copy the printed `model_manifest_sha256` into `terraform.tfvars`.

5. Set `inference_enabled = true`, review the paid plan, and apply it:

   ```bash
   terraform plan -out inference.tfplan
   terraform apply inference.tfplan
   ```

6. Stop the instance as soon as the bootstrap and experiment finish:

   ```bash
   ./scripts/stop.sh
   ```

## Run the qualification baseline

Start the cell, then keep the SSM tunnel open in one terminal:

```bash
./scripts/start.sh
./scripts/tunnel.sh
```

In a second terminal, run three complete development-suite repetitions. The
runner retrieves the bearer key without printing it and emits a proof-carrying
report:

```bash
./scripts/run-baseline.sh /tmp/amos-qwen-aws-baseline.json
```

Then stop the instance:

```bash
./scripts/stop.sh
```

The first comparison is direct AWS Qwen versus the local baseline on quality,
time to first token, decode throughput, wall time, and recovery. Swarm Mode v0
then submits at most three concurrent logical worker contexts to this same
endpoint. Additional GPUs are justified only by measured queueing or
utilization—not by the number of logical agents.

After the qualification contract is healthy, run the three visible
development missions through both Qwen controls without exposing the bearer
key:

```bash
./scripts/run-swarm.sh /tmp/amos-qwen-swarm-v0 3
```

This writes separate content-addressed Direct Qwen and Swarm Qwen reports. Stop
the instance immediately afterward; Fable runs separately through the
loopback Bedrock benchmark gateway and does not require the Qwen GPU.

The helper also accepts an optional mission manifest and experiment config.
For the visible challenge suite with the Opus-compatible comparison contract:

```bash
./scripts/run-swarm.sh \
  /tmp/amos-qwen-opus-challenge 3 \
  benchmarks/swarm-challenge-missions-v0.json \
  benchmarks/swarm-experiment-opus-v0.json
```

The bearer key is retrieved with the AWS SDK and remains only in the benchmark
process environment; it is never printed or written into a report.
Optional fifth and sixth arguments select one Qwen control and one mission ID,
which supports inexpensive fail-fast probes before a full suite run.

## Recovery and operations

- `systemctl status amos-qwen` and `journalctl -u amos-qwen` are available in
  an SSM shell.
- `/var/log/amos-qwen-bootstrap.log` records model and runtime verification.
- The service restarts after model-process failure.
- Model and image digest mismatch fails bootstrap closed.
- `start.sh` and `stop.sh` preserve the encrypted root volume; destroying the
  instance removes it.
- Do not place customer data in the research bucket. Research inputs continue
  to use the permitted-use and signed-evaluation contracts in
  `docs/RESEARCH_EXPERIMENT_PROTOCOL.md`.
