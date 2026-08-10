import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  createTaskWorktree,
  inspectTaskWorkspace,
  portableTaskWorkspace
} from "../src/desktop/taskWorkspace.js";

const execFile = promisify(execFileCallback);

async function git(...args) {
  return execFile("git", args, { encoding: "utf8" });
}

test("task worktrees start at committed state and preserve dirty parent changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-task-worktree-"));
  const repository = join(directory, "company-repo");
  await git("init", "-b", "main", repository);
  await git("-C", repository, "config", "user.email", "test@amos.local");
  await git("-C", repository, "config", "user.name", "AMOS Test");
  await git("-C", repository, "config", "commit.gpgsign", "false");
  await writeFile(join(repository, "plan.md"), "committed\n", "utf8");
  await git("-C", repository, "add", "plan.md");
  await git("-C", repository, "commit", "-m", "Initial plan");
  await writeFile(join(repository, "plan.md"), "dirty parent\n", "utf8");

  const inspected = await inspectTaskWorkspace(repository);
  const worktree = await createTaskWorktree(repository, {
    name: "Explore Upsell",
    id: "12345678-abcd"
  });

  assert.equal(inspected.dirty, true);
  assert.equal(worktree.parent.dirty, true);
  assert.match(worktree.branch, /^amos\/fork-explore-upsell-/);
  assert.equal(await readFile(join(worktree.localPath, "plan.md"), "utf8"), "committed\n");
  assert.equal(await readFile(join(repository, "plan.md"), "utf8"), "dirty parent\n");
  assert.match(worktree.warning, /were not copied/);
});

test("portable task workspaces never expose an absolute local path", () => {
  assert.deepEqual(portableTaskWorkspace({
    localPath: "/Users/someone/private",
    label: "AMOS Platform",
    repository: "git@github.com:amos-labs/amos-managed-platform.git",
    branch: "amos/fork-analysis-abcd",
    commit: "a".repeat(40),
    dirty: true
  }), {
    label: "AMOS Platform",
    repository: "git@github.com:amos-labs/amos-managed-platform.git",
    branch: "amos/fork-analysis-abcd",
    commit: "a".repeat(40),
    dirty: true
  });
});

test("portable task workspaces strip repository credentials and query secrets", () => {
  assert.equal(
    portableTaskWorkspace({
      repository: "https://token:secret@github.com/amos-labs/platform.git?key=hidden#frag"
    }).repository,
    "https://github.com/amos-labs/platform.git"
  );
  assert.equal(portableTaskWorkspace({ repository: "/Users/private/company" }).repository, "");
  assert.equal(
    portableTaskWorkspace({ repository: "git@github.com:amos-labs/platform.git" }).repository,
    "git@github.com:amos-labs/platform.git"
  );
});
