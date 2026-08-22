import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  appendResearchExperimentEvent,
  createResearchExperimentLedger,
  digestResearchValue,
  validateResearchEvaluationManifest,
  validateResearchExperimentLedger,
  validateResearchExperimentProposal
} from "./experimentProtocol.js";
import {
  validateResearchEvaluationAttestation,
  verifyResearchEvaluationAttestation
} from "./evaluationAttestation.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const EXPERIMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const HEAD_PATTERN = /^(\d{8})-([a-f0-9]{64})\.ref$/;

export async function openResearchExperimentStore(rootPath, options = {}) {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw new Error("Research experiment store root must be a non-empty path");
  }
  const configuredRoot = resolve(rootPath);
  await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
  await assertDirectory(configuredRoot, "Research experiment store root");
  const root = await realpath(configuredRoot);
  const objectsDirectory = join(root, "objects");
  const experimentsDirectory = join(root, "experiments");
  await mkdir(objectsDirectory, { recursive: true, mode: 0o700 });
  await mkdir(experimentsDirectory, { recursive: true, mode: 0o700 });
  await assertDirectory(objectsDirectory, "Research object directory");
  await assertDirectory(experimentsDirectory, "Research experiment directory");
  return new ResearchExperimentStore({
    root,
    objectsDirectory,
    experimentsDirectory,
    lockTimeoutMs: positiveIntegerOption(options.lockTimeoutMs, 5_000),
    staleLockMs: positiveIntegerOption(options.staleLockMs, 30_000),
    lockRetryMs: positiveIntegerOption(options.lockRetryMs, 25)
  });
}

export class ResearchExperimentStore {
  constructor({
    root,
    objectsDirectory,
    experimentsDirectory,
    lockTimeoutMs,
    staleLockMs,
    lockRetryMs
  }) {
    this.root = root;
    this.objectsDirectory = objectsDirectory;
    this.experimentsDirectory = experimentsDirectory;
    this.lockTimeoutMs = lockTimeoutMs;
    this.staleLockMs = staleLockMs;
    this.lockRetryMs = lockRetryMs;
  }

  async putObject(value) {
    const digest = digestResearchValue(value);
    const objectPath = this.objectPath(digest);
    await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
    await assertDirectory(dirname(objectPath), "Research object shard");
    await writeImmutableText(objectPath, `${JSON.stringify(value, null, 2)}\n`);
    const stored = await this.readObject(digest);
    if (digestResearchValue(stored) !== digest) {
      throw new Error(`Stored research object ${digest} failed verification`);
    }
    return digest;
  }

  async readObject(digest) {
    assertDigest(digest, "Research object digest");
    const objectPath = this.objectPath(digest);
    await assertRegularFile(objectPath, `Research object ${digest}`);
    let value;
    try {
      value = JSON.parse(await readFile(objectPath, "utf8"));
    } catch (error) {
      throw new Error(`Research object ${digest} is unreadable: ${error.message}`);
    }
    if (digestResearchValue(value) !== digest) {
      throw new Error(`Research object ${digest} does not match its content digest`);
    }
    return value;
  }

  async initializeExperiment(inputProposal, inputEvaluationManifest) {
    const evaluationManifest = validateResearchEvaluationManifest(inputEvaluationManifest);
    const proposal = validateResearchExperimentProposal(inputProposal, { evaluationManifest });
    validateExperimentId(proposal.id);
    const proposalDigest = await this.putObject(proposal);
    const evaluationManifestDigest = await this.putObject(evaluationManifest);
    const ledger = createResearchExperimentLedger(proposal, evaluationManifest);
    const ledgerDigest = await this.putObject(ledger);
    const paths = await this.ensureExperimentDirectories(proposal.id);

    return this.withLock(paths.lock, async () => {
      await writeImmutableRef(paths.proposalRef, proposalDigest);
      await writeImmutableRef(paths.evaluationRef, evaluationManifestDigest);
      await writeImmutableRef(this.headPath(paths.heads, 0, ledgerDigest), ledgerDigest);
      return this.loadExperiment(proposal.id);
    });
  }

  async loadExperiment(experimentId) {
    validateExperimentId(experimentId);
    const paths = this.experimentPaths(experimentId);
    await assertDirectory(paths.directory, `Experiment ${experimentId}`);
    await assertDirectory(paths.heads, `Experiment ${experimentId} heads`);
    const proposalDigest = await readRef(paths.proposalRef, "Proposal reference");
    const evaluationManifestDigest = await readRef(
      paths.evaluationRef,
      "Evaluation manifest reference"
    );
    const proposal = await this.readObject(proposalDigest);
    const evaluationManifest = await this.readObject(evaluationManifestDigest);
    validateResearchEvaluationManifest(evaluationManifest);
    validateResearchExperimentProposal(proposal, { evaluationManifest });
    if (proposal.id !== experimentId) {
      throw new Error("Experiment directory does not match the stored proposal id");
    }

    const heads = await this.readHeads(paths.heads);
    const latestHead = heads.at(-1);
    const ledger = validateResearchExperimentLedger(await this.readObject(latestHead.digest));
    if (
      ledger.experimentId !== experimentId ||
      ledger.proposalDigest !== proposalDigest ||
      ledger.evaluationManifestDigest !== evaluationManifestDigest
    ) {
      throw new Error("Experiment ledger is not bound to its stored proposal and evaluator");
    }
    if (ledger.events.length - 1 !== latestHead.sequence) {
      throw new Error("Experiment head sequence does not match the ledger event count");
    }
    return {
      experimentId,
      proposal,
      proposalDigest,
      evaluationManifest,
      evaluationManifestDigest,
      ledger,
      ledgerDigest: latestHead.digest,
      generation: latestHead.sequence
    };
  }

  async appendEvent(experimentId, event) {
    validateExperimentId(experimentId);
    const paths = this.experimentPaths(experimentId);
    return this.withLock(paths.lock, async () => {
      const current = await this.loadExperiment(experimentId);
      const ledger = appendResearchExperimentEvent(current.ledger, event);
      const ledgerDigest = await this.putObject(ledger);
      const generation = current.generation + 1;
      await writeImmutableRef(
        this.headPath(paths.heads, generation, ledgerDigest),
        ledgerDigest
      );
      return { ledger, ledgerDigest, generation };
    });
  }

  async recordAttestedOutcome(experimentId, {
    outcome,
    attestation,
    publicKey
  }) {
    const current = await this.loadExperiment(experimentId);
    if (current.ledger.state !== "running") {
      throw new Error(`Cannot record an outcome while ledger is ${current.ledger.state}`);
    }
    const verified = verifyResearchEvaluationAttestation({
      attestation,
      proposal: current.proposal,
      evaluationManifest: current.evaluationManifest,
      outcome,
      publicKey
    });
    const outcomeDigest = await this.putObject(outcome);
    const normalizedAttestation = validateResearchEvaluationAttestation(attestation);
    if (normalizedAttestation.payload.outcomeDigest !== outcomeDigest) {
      throw new Error("Attestation outcome digest does not match stored outcome");
    }
    const attestationDigest = await this.putObject(normalizedAttestation);
    const recorded = await this.appendEvent(experimentId, {
      type: "outcome_recorded",
      at: normalizedAttestation.payload.issuedAt,
      actor: {
        kind: "service",
        id: normalizedAttestation.payload.evaluator.id
      },
      subjectDigest: attestationDigest
    });
    return {
      ...recorded,
      outcomeDigest,
      attestationDigest,
      decision: verified.decision
    };
  }

  objectPath(digest) {
    assertDigest(digest, "Research object digest");
    return join(this.objectsDirectory, digest.slice(0, 2), `${digest}.json`);
  }

  experimentPaths(experimentId) {
    validateExperimentId(experimentId);
    const directory = join(this.experimentsDirectory, experimentId);
    return {
      directory,
      heads: join(directory, "heads"),
      proposalRef: join(directory, "proposal.ref"),
      evaluationRef: join(directory, "evaluation.ref"),
      lock: join(directory, ".lock")
    };
  }

  headPath(headsDirectory, sequence, digest) {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 99_999_999) {
      throw new Error("Experiment generation must be between 0 and 99,999,999");
    }
    assertDigest(digest, "Experiment ledger digest");
    return join(headsDirectory, `${String(sequence).padStart(8, "0")}-${digest}.ref`);
  }

  async ensureExperimentDirectories(experimentId) {
    const paths = this.experimentPaths(experimentId);
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    await mkdir(paths.heads, { recursive: true, mode: 0o700 });
    await assertDirectory(paths.directory, `Experiment ${experimentId}`);
    await assertDirectory(paths.heads, `Experiment ${experimentId} heads`);
    return paths;
  }

  async readHeads(headsDirectory) {
    const entries = await readdir(headsDirectory, { withFileTypes: true });
    const heads = [];
    for (const entry of entries) {
      if (entry.name.includes(".tmp-")) continue;
      const match = HEAD_PATTERN.exec(entry.name);
      if (!match) throw new Error(`Unexpected experiment head entry: ${entry.name}`);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`Experiment head ${entry.name} must be a regular file`);
      }
      const sequence = Number(match[1]);
      const digest = match[2];
      const referencedDigest = await readRef(
        join(headsDirectory, entry.name),
        `Experiment head ${entry.name}`
      );
      if (referencedDigest !== digest) {
        throw new Error(`Experiment head ${entry.name} does not match its reference`);
      }
      heads.push({ sequence, digest });
    }
    heads.sort((left, right) => left.sequence - right.sequence);
    if (heads.length === 0) throw new Error("Experiment has no ledger heads");
    for (const [index, head] of heads.entries()) {
      if (head.sequence !== index) {
        throw new Error("Experiment ledger head sequence contains a gap or duplicate");
      }
    }
    return heads;
  }

  async withLock(lockPath, callback) {
    const token = randomUUID();
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
          await handle.sync();
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (await lockIsStale(lockPath, this.staleLockMs)) {
          await quarantineStaleLock(lockPath);
          continue;
        }
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error(`Timed out waiting for research experiment lock: ${lockPath}`);
        }
        await delay(this.lockRetryMs);
      }
    }

    try {
      return await callback();
    } finally {
      await releaseOwnedLock(lockPath, token);
    }
  }
}

async function writeImmutableRef(path, digest) {
  assertDigest(digest, "Research reference digest");
  await writeImmutableText(path, `${digest}\n`);
  const stored = await readRef(path, "Research reference");
  if (stored !== digest) throw new Error(`Immutable reference conflict at ${path}`);
}

async function writeImmutableText(path, text) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let linked = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, path);
      linked = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(path, "utf8");
      if (existing !== text) throw new Error(`Immutable research record conflict at ${path}`);
    }
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return linked;
}

async function readRef(path, label) {
  await assertRegularFile(path, label);
  const value = (await readFile(path, "utf8")).trim();
  assertDigest(value, label);
  return value;
}

async function assertDirectory(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist`);
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function assertRegularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist`);
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

async function lockIsStale(lockPath, staleLockMs) {
  try {
    const stats = await lstat(lockPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Research experiment lock must be a regular file");
    }
    return Date.now() - stats.mtimeMs > staleLockMs;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function quarantineStaleLock(lockPath) {
  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, quarantinePath);
    await unlink(quarantinePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function releaseOwnedLock(lockPath, token) {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8"));
    if (value.token !== token) return;
    await unlink(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function validateExperimentId(value) {
  if (!EXPERIMENT_ID_PATTERN.test(String(value || ""))) {
    throw new Error("Experiment id must use only letters, numbers, periods, underscores, and hyphens");
  }
}

function assertDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function positiveIntegerOption(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Research store timing options must be positive integers");
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
