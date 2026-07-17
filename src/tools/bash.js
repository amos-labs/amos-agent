import { spawn } from "node:child_process";
import { resolveWorkspacePath, truncateText } from "../util/pathSafety.js";

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
        maxOutputBytes: context.config.safety.maxOutputBytes
      });
    }
  };
}

export function runBash(command, { cwd, bashPath, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve) => {
    const child = spawn(bashPath, ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        error: error.message,
        stdout: truncateText(stdout, maxOutputBytes),
        stderr: truncateText(stderr, maxOutputBytes)
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exit_code: code,
        signal,
        timed_out: timedOut,
        cwd,
        stdout: truncateText(stdout, maxOutputBytes),
        stderr: truncateText(stderr, maxOutputBytes)
      });
    });
  });
}
