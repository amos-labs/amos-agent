import { spawn } from "node:child_process";
import { resolveWorkspacePath } from "../util/pathSafety.js";

export function createBashTool() {
  return {
    name: "run_bash",
    source: "local",
    description: "Run a bash command in the local workspace. The user approves each command by default.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to run through bash -lc."
        },
        workdir: {
          type: "string",
          description: "Workspace-relative directory for the command. Defaults to the workspace root."
        },
        timeout_ms: {
          type: "integer",
          description: "Optional timeout in milliseconds."
        },
        reason: {
          type: "string",
          description: "Brief reason this command is needed."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async handler(args, context) {
      const command = String(args.command || "").trim();
      if (!command) throw new Error("command is required");

      const cwd = resolveWorkspacePath(
        context.config.safety.workspaceRoot,
        args.workdir || ".",
        context.config.safety.allowOutsideWorkspace
      );
      const timeoutMs = Number(args.timeout_ms || context.config.safety.bashTimeoutMs);

      if (!context.config.safety.autoApproveBash) {
        const approved = await context.approvals.confirm(
          [
            "AMOS Agent wants to run bash:",
            "",
            command,
            "",
            `cwd: ${cwd}`,
            args.reason ? `reason: ${args.reason}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        );
        if (!approved) {
          return { ok: false, denied: true, message: "User denied bash command." };
        }
      }

      return runBash(command, {
        cwd,
        bashPath: context.config.safety.bashPath,
        timeoutMs,
        maxOutputBytes: context.config.safety.maxOutputBytes,
        signal: context.signal
      });
    }
  };
}

export function runBash(command, { cwd, bashPath, timeoutMs, maxOutputBytes, signal = null }) {
  return new Promise((resolve) => {
    const abortSignal = signal;
    const boundedTimeoutMs = boundedNumber(timeoutMs, 60_000, 100, 600_000);
    const boundedOutputBytes = boundedNumber(maxOutputBytes, 24_000, 1_024, 1_048_576);
    const child = spawn(bashPath, ["-lc", command], {
      cwd,
      env: safeChildEnvironment(process.env),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdout = boundedCollector(boundedOutputBytes);
    const stderr = boundedCollector(boundedOutputBytes);
    let timedOut = false;
    let canceled = false;
    let settled = false;
    let killTimer;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
      killTimer.unref?.();
    }, boundedTimeoutMs);
    timer.unref?.();
    const abort = () => {
      canceled = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
      killTimer.unref?.();
    };
    if (abortSignal?.aborted) abort();
    else abortSignal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout.add(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr.add(chunk);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        error: error.message,
        stdout: stdout.text(),
        stderr: stderr.text()
      });
    });

    child.on("close", (code, processSignal) => {
      finish({
        ok: code === 0 && !timedOut && !canceled,
        exit_code: code,
        signal: processSignal,
        timed_out: timedOut,
        canceled,
        cwd,
        stdout: stdout.text(),
        stderr: stderr.text()
      });
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      abortSignal?.removeEventListener("abort", abort);
      resolve(result);
    }
  });
}

export function safeChildEnvironment(env) {
  const safeNames = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TERM", "COLORTERM", "NO_COLOR"]);
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => safeNames.has(name) || name.startsWith("LC_"))
  );
}

function killProcessTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process may already have exited.
  }
}

function boundedCollector(maxBytes) {
  const chunks = [];
  let kept = 0;
  let total = 0;
  return {
    add(chunk) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      const remaining = maxBytes - kept;
      if (remaining > 0) {
        const slice = buffer.subarray(0, remaining);
        chunks.push(slice);
        kept += slice.length;
      }
    },
    text() {
      const value = Buffer.concat(chunks, kept).toString("utf8");
      return total > kept ? `${value}\n...[truncated ${total - kept} bytes]` : value;
    }
  };
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}
