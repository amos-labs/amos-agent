const vscode = require("vscode");
const { companionRequest } = require("./client");

function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  status.command = "amos.showStatus";
  status.text = "$(sparkle) AMOS";
  status.tooltip = "AMOS Desktop companion";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("amos.startTask", async () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.document.getText(editor.selection) || "";
      const file = editor?.document.fileName || "";
      const objective = await vscode.window.showInputBox({
        prompt: "What should AMOS do?",
        value: selection ? "Review and apply the selected change." : "Inspect this workspace and continue the current work."
      });
      if (!objective) return;
      const result = await companionRequest("/v1/tasks", {
        method: "POST",
        body: {
          objective,
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
          selection,
          files: file ? [file] : []
        }
      });
      vscode.window.showInformationMessage(`AMOS started task ${result.taskId || ""}`.trim());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("amos.sendWorkspace", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        throw new Error("Open a folder before sending it to AMOS Desktop");
      }
      await companionRequest("/v1/workspace", {
        method: "POST",
        body: { path: folder }
      });
      vscode.window.showInformationMessage(`AMOS workspace set to ${folder}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("amos.showStatus", async () => {
      const payload = await companionRequest("/v1/status");
      vscode.window.showInformationMessage(
        `AMOS ${payload.provider || "idle"} · ${payload.model || "no model"} · ${payload.workspace || "no workspace"}`
      );
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
