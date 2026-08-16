# AMOS Desktop for VS Code

Companion commands for a running **AMOS Desktop** session. The extension does
not run a second agent. It talks to the local Desktop companion on `127.0.0.1`
using the token Desktop writes to its application-data directory.

## Use

1. Start AMOS Desktop.
2. Open this folder in VS Code and run **Developer: Install Extension from Location…**, or launch an Extension Development Host against `extensions/vscode`.
3. Open the repository you want AMOS to edit.
4. Run **AMOS: Use this folder as the Desktop workspace**.
5. Select code and run **AMOS: Start task from selection**.

Desktop still owns approvals, worktrees, receipts, and the planner / builder / checker roles.
