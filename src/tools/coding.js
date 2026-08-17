import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { spawn } from "node:child_process";
import { assertSafeAgentPath, resolveWorkspacePath, truncateText } from "../util/pathSafety.js";
import {
  isGitRepo,
  relativeWorkspacePath,
  resolveDefaultWorkspacePath,
  rewritePatchForGitCwd,
  workspaceCommandCwd,
  workspaceFocusPath
} from "../util/workspaceFocus.js";
import { safeChildEnvironment } from "./bash.js";

const IGNORED = new Set([".git", "node_modules", "dist", "coverage", ".amos-agent", ".next", "target", "vendor"]);

export function createCodingTools() {
  return [
    {
      name: "desktop_inspect_project",
      source: "local",
      description:
        "Build a bounded, read-only briefing of the selected project. If the grant is a parent of nested repos, return that catalog instead of treating the parent as one project.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Optional workspace-relative folder to inspect. Defaults to the active work item, then the grant. Grant-root segments resolve grant-relative; segments unique to the focused work item resolve focus-relative."
          }
        },
        additionalProperties: false
      },
      async handler(args, context) {
        const root = resolveDefaultWorkspacePath(
          context.config.safety,
          args.path || ".",
          context.config.safety.allowOutsideWorkspace
        );
        return inspectProject(root, context);
      }
    },
    {
      name: "search_files",
      source: "local",
      description: "Search text across the local workspace and return matching files, line numbers, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Literal text to find." },
          path: { type: "string", description: "Workspace-relative directory or file. Defaults to ." },
          case_sensitive: { type: "boolean", description: "Default false." },
          max_results: { type: "integer", description: "Default 100, maximum 500." }
        },
        required: ["query"],
        additionalProperties: false
      },
      async handler(args, context) {
        const query = String(args.query || "");
        if (!query) throw new Error("query is required");
        const root = context.config.safety.workspaceRoot;
        const canonicalRoot = resolveWorkspacePath(root, ".", context.config.safety.allowOutsideWorkspace);
        const start = resolveDefaultWorkspacePath(context.config.safety, args.path || ".", context.config.safety.allowOutsideWorkspace);
        const maxResults = boundedNumber(args.max_results, 100, 1, 500);
        const matches = [];
        const budget = { files: 0, maxFiles: 2_000 };
        await searchPath(start, canonicalRoot, query, Boolean(args.case_sensitive), matches, maxResults, budget);
        return {
          query,
          matches,
          scanned_files: budget.files,
          truncated: matches.length >= maxResults || budget.files >= budget.maxFiles
        };
      }
    },
    {
      name: "git_status",
      source: "local",
      description: "Inspect the current workspace's branch and changed files without modifying anything.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async handler(_args, context) {
        return runProgram("git", ["status", "--short", "--branch"], {
          cwd: workspaceFocusPath(context.config.safety),
          timeoutMs: 15_000,
          maxOutputBytes: context.config.safety.maxOutputBytes,
          signal: context.signal
        });
      }
    },
    {
      name: "git_diff",
      source: "local",
      description: "Inspect the current workspace diff. Optionally limit it to safe workspace-relative paths.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged changes instead of unstaged changes." },
          paths: { type: "array", items: { type: "string" }, description: "Optional workspace-relative paths." }
        },
        additionalProperties: false
      },
      async handler(args, context) {
        const root = context.config.safety.workspaceRoot;
        const requested = args.paths || [];
        const cwd = requested.length > 0
          ? workspaceCommandCwd(context.config.safety, requested)
          : workspaceFocusPath(context.config.safety);
        const paths = requested.map((path) => {
          const resolved = resolveDefaultWorkspacePath(context.config.safety, path, context.config.safety.allowOutsideWorkspace);
          assertSafeAgentPath(resolved, root);
          return relative(cwd, resolved) || ".";
        });
        const command = ["diff"];
        if (args.staged) command.push("--cached");
        if (paths.length > 0) command.push("--", ...paths);
        return runProgram("git", command, {
          cwd,
          timeoutMs: 15_000,
          maxOutputBytes: context.config.safety.maxOutputBytes,
          signal: context.signal
        });
      }
    },
    {
      name: "apply_patch",
      source: "local",
      description: "Apply a unified text patch atomically inside the local workspace after user approval.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Unified diff using a/ and b/ workspace-relative paths." },
          reason: { type: "string", description: "Brief reason for the change." }
        },
        required: ["patch"],
        additionalProperties: false
      },
      async handler(args, context) {
        const patch = String(args.patch || "");
        if (!patch.trim()) throw new Error("patch is required");
        if (Buffer.byteLength(patch) > 512_000) throw new Error("Patch exceeds the 512 KB limit");
        if (patch.includes("GIT binary patch")) throw new Error("Binary patches are not supported");

        const root = context.config.safety.workspaceRoot;
        const paths = parsePatchPaths(patch);
        const focus = workspaceCommandCwd(context.config.safety, paths);
        const gitPatch = rewritePatchForGitCwd(patch, root, focus);
        if (paths.length === 0) throw new Error("Patch did not contain any file paths");
        for (const path of paths) {
          const resolved = resolveDefaultWorkspacePath(context.config.safety, path, context.config.safety.allowOutsideWorkspace);
          assertSafeAgentPath(resolved, root);
        }

        const checked = await runProgram("git", ["apply", "--check", "--recount", "--whitespace=nowarn", "-"], {
          cwd: focus,
          input: gitPatch,
          timeoutMs: 20_000,
          maxOutputBytes: context.config.safety.maxOutputBytes,
          signal: context.signal
        });
        if (!checked.ok) return { ...checked, phase: "check", files: paths };

        if (
          !context.config.safety.autoApproveWrites &&
          !context.config.safety.autoApproveKinds?.includes("code-patch")
        ) {
          const approved = await context.approvals.confirm(
            [
              "AMOS wants to apply a local code patch:",
              "",
              ...paths.map((path) => `• ${path}`),
              args.reason ? `\nreason: ${args.reason}` : "",
              `\n${truncateText(patch, 8_000)}`
            ].join("\n"),
            { kind: "code-patch" }
          );
          if (!approved) return { ok: false, denied: true, message: "User denied code patch.", files: paths };
        }

        const applied = await runProgram("git", ["apply", "--recount", "--whitespace=nowarn", "-"], {
          cwd: focus,
          input: gitPatch,
          timeoutMs: 20_000,
          maxOutputBytes: context.config.safety.maxOutputBytes,
          signal: context.signal
        });
        return { ...applied, phase: "apply", files: paths };
      }
    }
  ];
}

async function inspectProject(root, context) {
  const grant = context.config.safety.workspaceRoot;
  const focus = workspaceFocusPath(context.config.safety);
  const children = await listChildProjects(root, grant, context);
  if (!isGitRepo(root) && children.length > 0) {
    return {
      kind: "workspace_catalog",
      project: basename(root),
      workspace: root,
      grant,
      focus: focus && focus !== root ? focus : "",
      branch: null,
      git: {
        repository: false,
        dirty: null,
        changes: [],
        recent_commits: []
      },
      stack: [],
      manifests: [],
      scripts: {},
      verification: [],
      readme: null,
      projects: children,
      inventory: {
        files: 0,
        directories: children.length,
        truncated: children.length >= 40,
        top_extensions: []
      },
      sensitive_files:
        "Names and contents of .env, credentials, keys, and secrets were intentionally excluded.",
      suggested_tasks: catalogSuggestions(children)
    };
  }

  const inventory = {
    files: 0,
    directories: 0,
    truncated: false,
    extensions: new Map(),
    manifests: [],
    notable: []
  };
  await inventoryPath(root, root, inventory);
  const manifestSet = new Set(inventory.manifests);
  const packageJson = manifestSet.has("package.json")
    ? await readJson(join(root, "package.json"))
    : null;
  const readmePath = inventory.notable.find((path) => /^readme(?:\.|$)/i.test(basename(path)));
  const readme = readmePath
    ? truncateText(await readFile(join(root, readmePath), "utf8").catch(() => ""), 6_000)
    : "";
  const [status, branch, recent] = await Promise.all([
    runProgram("git", ["status", "--short"], {
      cwd: root,
      timeoutMs: 10_000,
      maxOutputBytes: context.config.safety.maxOutputBytes,
      signal: context.signal
    }),
    runProgram("git", ["branch", "--show-current"], {
      cwd: root,
      timeoutMs: 10_000,
      maxOutputBytes: context.config.safety.maxOutputBytes,
      signal: context.signal
    }),
    runProgram("git", ["log", "-5", "--pretty=format:%h %s"], {
      cwd: root,
      timeoutMs: 10_000,
      maxOutputBytes: context.config.safety.maxOutputBytes,
      signal: context.signal
    })
  ]);
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object"
    ? Object.fromEntries(
        Object.entries(packageJson.scripts)
          .slice(0, 40)
          .map(([name, command]) => [String(name).slice(0, 80), String(command).slice(0, 500)])
      )
    : {};
  const verification = verificationCommands(manifestSet, scripts);
  const stack = detectedStack(manifestSet, packageJson, inventory.extensions);
  return {
    kind: "project",
    project: packageJson?.name || basename(root),
    workspace: root,
    grant,
    focus: focus && focus !== root ? focus : "",
    branch: branch.ok ? branch.stdout.trim() || null : null,
    git: {
      repository: branch.ok || status.ok || recent.ok,
      dirty: status.ok ? Boolean(status.stdout.trim()) : null,
      changes: status.ok ? status.stdout.trim().split("\n").filter(Boolean).slice(0, 100) : [],
      recent_commits: recent.ok ? recent.stdout.trim().split("\n").filter(Boolean) : []
    },
    stack,
    manifests: inventory.manifests,
    scripts,
    verification,
    readme: readme ? { path: readmePath, excerpt: readme } : null,
    inventory: {
      files: inventory.files,
      directories: inventory.directories,
      truncated: inventory.truncated,
      top_extensions: [...inventory.extensions.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 15)
        .map(([extension, count]) => ({ extension, count }))
    },
    sensitive_files:
      "Names and contents of .env, credentials, keys, and secrets were intentionally excluded.",
    suggested_tasks: [
      "Explain the architecture and main execution paths with file citations",
      verification.length > 0
        ? `Run the most relevant existing check: ${verification[0]}`
        : "Identify the project's real verification path before changing code",
      status.ok && status.stdout.trim()
        ? "Review the existing working-tree changes before editing overlapping files"
        : "Identify one small, high-value improvement and propose it before editing"
    ]
  };
}


async function listChildProjects(root, grant, context) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const children = [];
  for (const entry of entries) {
    if (children.length >= 40) break;
    if (!entry.isDirectory()) continue;
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
    const absolute = join(root, entry.name);
    if (!isGitRepo(absolute)) continue;
    const [branch, packageJson] = await Promise.all([
      runProgram("git", ["branch", "--show-current"], {
        cwd: absolute,
        timeoutMs: 5_000,
        maxOutputBytes: context.config.safety.maxOutputBytes,
        signal: context.signal
      }),
      readJson(join(absolute, "package.json"))
    ]);
    children.push({
      path: relativeWorkspacePath(grant, absolute),
      name: packageJson?.name || entry.name,
      branch: branch.ok ? branch.stdout.trim() || null : null,
      stack: packageJson ? detectedStack(new Set(["package.json"]), packageJson, new Map()) : []
    });
  }
  return children;
}

function catalogSuggestions(children) {
  const first = children[0];
  return [
    first
      ? `Use desktop_focus_workspace on ${first.path} before treating this grant as one project`
      : "Choose one nested project before inspecting or editing",
    "Do not inventory the parent grant as if it were a single repository"
  ];
}

async function inventoryPath(path, root, inventory) {
  if (inventory.files >= 5_000) {
    inventory.truncated = true;
    return;
  }
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (inventory.files >= 5_000) {
      inventory.truncated = true;
      return;
    }
    if (
      IGNORED.has(entry.name) ||
      entry.name === ".env" ||
      entry.name.startsWith(".env.") ||
      /(?:credential|secret|private[-_.]?key)/i.test(entry.name)
    ) {
      continue;
    }
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) {
      inventory.directories += 1;
      await inventoryPath(absolute, root, inventory);
      continue;
    }
    if (!entry.isFile()) continue;
    inventory.files += 1;
    const projectPath = relative(root, absolute);
    const extension = extname(entry.name).toLowerCase() || "[no extension]";
    inventory.extensions.set(extension, (inventory.extensions.get(extension) || 0) + 1);
    if (MANIFEST_NAMES.has(entry.name) && !projectPath.includes("/")) {
      inventory.manifests.push(projectPath);
    }
    if (/^(readme|contributing|architecture)(?:\.|$)/i.test(entry.name)) {
      inventory.notable.push(projectPath);
    }
  }
}

const MANIFEST_NAMES = new Set([
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "Package.swift",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml"
]);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function detectedStack(manifests, packageJson, extensions) {
  const stack = [];
  if (manifests.has("package.json")) {
    stack.push("Node.js");
    const dependencies = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {})
    };
    for (const [dependency, label] of [
      ["next", "Next.js"],
      ["react", "React"],
      ["electron", "Electron"],
      ["vue", "Vue"],
      ["svelte", "Svelte"],
      ["express", "Express"]
    ]) {
      if (dependencies[dependency]) stack.push(label);
    }
  }
  if (manifests.has("Cargo.toml")) stack.push("Rust");
  if (manifests.has("go.mod")) stack.push("Go");
  if (manifests.has("Gemfile")) stack.push("Ruby");
  if (manifests.has("pyproject.toml") || manifests.has("requirements.txt")) stack.push("Python");
  if (manifests.has("Package.swift")) stack.push("Swift");
  if (extensions.has(".ts") || extensions.has(".tsx")) stack.push("TypeScript");
  return [...new Set(stack)];
}

function verificationCommands(manifests, scripts) {
  const commands = [];
  for (const name of ["check", "test", "lint", "typecheck", "build"]) {
    if (scripts[name]) commands.push(`npm run ${name}`);
  }
  if (manifests.has("Cargo.toml")) commands.push("cargo test", "cargo clippy --all-targets");
  if (manifests.has("go.mod")) commands.push("go test ./...");
  if (manifests.has("Gemfile")) commands.push("bundle exec rspec");
  if (manifests.has("pyproject.toml") || manifests.has("requirements.txt")) commands.push("pytest");
  return [...new Set(commands)].slice(0, 10);
}

export function parsePatchPaths(patch) {
  const paths = new Set();
  for (const line of String(patch).split(/\r?\n/)) {
    const match = /^(?:---|\+\+\+) ([^\t]+)(?:\t.*)?$/.exec(line);
    if (!match || match[1] === "/dev/null") continue;
    let value = match[1];
    if (value.startsWith("\"") || value.includes("\\\"")) {
      throw new Error("Quoted patch paths are not supported");
    }
    value = value.replace(/^[ab]\//, "");
    if (!value || value.startsWith("/") || value.split("/").includes("..")) {
      throw new Error(`Unsafe patch path: ${value}`);
    }
    paths.add(value);
  }
  return [...paths];
}

async function searchPath(start, root, query, caseSensitive, matches, maxResults, budget) {
  if (matches.length >= maxResults || budget.files >= budget.maxFiles) return;
  const info = await stat(start);
  if (info.isFile()) {
    budget.files += 1;
    await searchFile(start, root, query, caseSensitive, matches, maxResults);
    return;
  }
  const entries = await readdir(start, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= maxResults || budget.files >= budget.maxFiles) return;
    if (IGNORED.has(entry.name) || entry.name === ".env" || entry.name.startsWith(".env.")) continue;
    const path = `${start}/${entry.name}`;
    if (entry.isDirectory()) await searchPath(path, root, query, caseSensitive, matches, maxResults, budget);
    else if (entry.isFile()) {
      budget.files += 1;
      await searchFile(path, root, query, caseSensitive, matches, maxResults);
    }
  }
}

async function searchFile(path, root, query, caseSensitive, matches, maxResults) {
  const info = await stat(path);
  if (info.size > 2_000_000) return;
  const buffer = await readFile(path);
  if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) return;
  const needle = caseSensitive ? query : query.toLowerCase();
  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
    const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
    if (!haystack.includes(needle)) continue;
    matches.push({
      path: relative(root, path),
      line: index + 1,
      text: lines[index].slice(0, 500)
    });
  }
}

export function runProgram(command, args, { cwd, input = "", timeoutMs, maxOutputBytes, signal = null }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: safeChildEnvironment(process.env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let canceled = false;
    let settled = false;
    let stdinError = null;
    const limit = boundedNumber(maxOutputBytes, 24_000, 1_024, 1_048_576);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, boundedNumber(timeoutMs, 15_000, 100, 600_000));
    const abort = () => {
      canceled = true;
      child.kill("SIGKILL");
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]).subarray(0, limit);
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(0, limit);
    });
    child.stdin.on("error", (error) => {
      // Short-lived read-only programs may exit before Node closes their unused
      // stdin pipe. Treat that empty-input EPIPE as harmless, but remember
      // failures when a command actually required input (for example git apply).
      stdinError = error;
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code, signal) => finish({
      ok: code === 0 && !timedOut && !canceled && !(stdinError && input.length > 0),
      exit_code: code,
      signal,
      timed_out: timedOut,
      canceled,
      stdin_error: stdinError && input.length > 0 ? stdinError.message : null,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8")
    }));
    child.stdin.end(input);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    }
  });
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}
