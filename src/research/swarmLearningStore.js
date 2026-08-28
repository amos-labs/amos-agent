import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { digestResearchValue } from "./experimentProtocol.js";
import {
  SwarmLearningArena,
  validateSwarmLearningEpisode
} from "./swarmLearningArena.js";
import { validateSwarmFailureCapsule } from "./swarmFailureCapsule.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const EPISODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,499}$/;

export async function openSwarmLearningStore(rootPath) {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw new Error("Swarm learning store root must be a non-empty path");
  }
  const configured = resolve(rootPath);
  await mkdir(join(configured, "objects"), { recursive: true, mode: 0o700 });
  await mkdir(join(configured, "blobs"), { recursive: true, mode: 0o700 });
  await mkdir(join(configured, "episodes"), { recursive: true, mode: 0o700 });
  await mkdir(join(configured, "capsules", "by-instruction"), { recursive: true, mode: 0o700 });
  const root = await realpath(configured);
  return new SwarmLearningStore({
    root,
    objectsDirectory: join(root, "objects"),
    blobsDirectory: join(root, "blobs"),
    episodesDirectory: join(root, "episodes"),
    capsulesDirectory: join(root, "capsules", "by-instruction")
  });
}

export class SwarmLearningStore {
  constructor({ root, objectsDirectory, blobsDirectory, episodesDirectory, capsulesDirectory }) {
    this.root = root;
    this.objectsDirectory = objectsDirectory;
    this.blobsDirectory = blobsDirectory;
    this.episodesDirectory = episodesDirectory;
    this.capsulesDirectory = capsulesDirectory;
  }

  async recordEpisode(input) {
    const episode = validateSwarmLearningEpisode(input);
    validateEpisodeId(episode.id);
    const objectPath = this.objectPath(episode.digest);
    await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
    await writeImmutable(objectPath, `${JSON.stringify(episode, null, 2)}\n`);
    const refPath = join(this.episodesDirectory, `${episode.id}.ref`);
    await writeImmutable(refPath, `${episode.digest}\n`);
    const stored = await this.readEpisode(episode.id);
    if (stored.digest !== episode.digest) throw new Error("Stored swarm episode failed verification");
    return stored;
  }

  async readEpisode(episodeId) {
    validateEpisodeId(episodeId);
    const digest = (await readFile(join(this.episodesDirectory, `${episodeId}.ref`), "utf8")).trim();
    validateDigest(digest);
    const value = JSON.parse(await readFile(this.objectPath(digest), "utf8"));
    const episode = validateSwarmLearningEpisode(value);
    if (episode.digest !== digest) throw new Error("Episode reference does not match its object");
    return episode;
  }

  async putBlob(value) {
    const contents = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const digest = createHash("sha256").update(contents).digest("hex");
    const path = this.blobPath(digest);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeImmutableBuffer(path, contents);
    const stored = await readFile(path);
    if (createHash("sha256").update(stored).digest("hex") !== digest) {
      throw new Error(`Stored swarm blob ${digest} failed verification`);
    }
    return digest;
  }

  /**
   * Index an immutable negative-experience capsule by exact mission text.
   *
   * HRR may later retrieve this capsule's id as an associative hint, but the
   * exact instruction digest, content digest, and capsule signature remain the
   * authority boundary for source reuse.
   */
  async recordFailureCapsule(input) {
    const capsule = validateSwarmFailureCapsule(input);
    const instructionDigest = capsule.task.instructionDigest;
    if (!instructionDigest) {
      throw new Error("Indexed failure capsules require an exact instruction digest");
    }
    validateDigest(instructionDigest);
    const contents = Buffer.from(`${JSON.stringify(capsule, null, 2)}\n`, "utf8");
    const blobDigest = await this.putBlob(contents);
    const directory = join(this.capsulesDirectory, instructionDigest);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeImmutable(join(directory, `${capsule.digest}.ref`), `${blobDigest}\n`);
    const stored = await this.readFailureCapsule(blobDigest);
    if (stored.digest !== capsule.digest) {
      throw new Error("Stored swarm failure capsule failed verification");
    }
    return { capsule: stored, blobDigest };
  }

  async readFailureCapsule(blobDigest) {
    const contents = await this.readBlob(blobDigest);
    return validateSwarmFailureCapsule(JSON.parse(contents.toString("utf8")));
  }

  async listFailureCapsules({ instructionDigest } = {}) {
    validateDigest(instructionDigest);
    const directory = join(this.capsulesDirectory, instructionDigest);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const capsules = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".ref")) continue;
      const blobDigest = (await readFile(join(directory, entry.name), "utf8")).trim();
      validateDigest(blobDigest);
      const capsule = await this.readFailureCapsule(blobDigest);
      if (capsule.task.instructionDigest !== instructionDigest) {
        throw new Error("Failure capsule instruction index does not match its contents");
      }
      capsules.push({ capsule, blobDigest });
    }
    return capsules.sort((left, right) =>
      String(right.capsule.execution?.finishedAt || "").localeCompare(
        String(left.capsule.execution?.finishedAt || "")
      ) || right.capsule.digest.localeCompare(left.capsule.digest)
    );
  }

  async readBlob(digest) {
    validateDigest(digest);
    const contents = await readFile(this.blobPath(digest));
    if (createHash("sha256").update(contents).digest("hex") !== digest) {
      throw new Error(`Swarm blob ${digest} does not match its content digest`);
    }
    return contents;
  }

  async listEpisodes() {
    const entries = await readdir(this.episodesDirectory, { withFileTypes: true });
    const episodes = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".ref")) continue;
      episodes.push(await this.readEpisode(entry.name.slice(0, -4)));
    }
    return episodes;
  }

  async arena() {
    return new SwarmLearningArena({ episodes: await this.listEpisodes() });
  }

  objectPath(digest) {
    validateDigest(digest);
    return join(this.objectsDirectory, digest.slice(0, 2), `${digest}.json`);
  }

  blobPath(digest) {
    validateDigest(digest);
    return join(this.blobsDirectory, digest.slice(0, 2), `${digest}.blob`);
  }
}

async function writeImmutable(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== contents) throw new Error(`Immutable swarm learning record differs: ${path}`);
  } finally {
    await handle?.close();
  }
}

async function writeImmutableBuffer(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(contents);
    await handle.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (!existing.equals(contents)) throw new Error(`Immutable swarm blob differs: ${path}`);
  } finally {
    await handle?.close();
  }
}

function validateEpisodeId(value) {
  if (!EPISODE_ID_PATTERN.test(value)) throw new Error("Unsupported swarm episode id");
}

function validateDigest(value) {
  if (!DIGEST_PATTERN.test(value)) throw new Error("Invalid swarm learning object digest");
}

export function swarmLearningStoreDigest(episodes) {
  return digestResearchValue(episodes.map(({ digest }) => digest).sort());
}
