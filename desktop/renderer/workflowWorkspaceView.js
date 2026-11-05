import {
  focusedWorkspace,
  workspaceAllowsView,
} from "../../src/desktop/workflowWorkspace.js";

/** Workflow UI adapter. It renders trusted normalized data; no policy inference. */
export function createWorkflowWorkspaceView({
  document,
  getState,
  api,
  showView,
  getCurrentView,
  availableSurfaceManifest,
  refresh,
  toast,
}) {
  function render() {
    const state = getState();
    const workspace = state?.workflowWorkspace;
    const focused = focusedWorkspace(workspace, state?.identity?.tenant_id);
    const container = document.getElementById("workflowNav");
    container.replaceChildren();
    document
      .getElementById("workflowWorkspaceButton")
      .classList.toggle("hidden", workspace?.supported !== true);
    for (const button of document.querySelectorAll(".nav-item[data-view]")) {
      button.classList.toggle(
        "workflow-hidden",
        !workspaceAllowsView(
          workspace,
          state?.identity?.tenant_id,
          button.dataset.view,
        ),
      );
    }
    document
      .getElementById("addSurfaceButton")
      .classList.toggle("workflow-hidden", focused);
    if (!focused) return;
    for (const item of workspace.navigation) {
      if (
        item.view?.startsWith("surface:") &&
        !availableSurfaceManifest(item.view.slice(8))
      )
        continue;
      if (
        item.view &&
        [...document.querySelectorAll(".nav-item[data-view]")].some(
          (node) => node.dataset.view === item.view,
        )
      )
        continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-item";
      button.textContent = `${item.label}${item.view ? "" : " ↗"}`;
      button.addEventListener("click", () => {
        if (item.view) showView(item.view);
        else if (item.webPath) {
          try {
            void api.openExternal(
              new URL(item.webPath, getState().settings.amosMcpUrl).href,
            );
          } catch {
            toast("Connect your company to open this page.", true);
          }
        }
      });
      container.append(button);
    }
    if (
      !workspaceAllowsView(
        workspace,
        state.identity.tenant_id,
        getCurrentView(),
      )
    )
      showView("operator");
  }

  function open() {
    const state = getState();
    const workspace = state?.workflowWorkspace;
    if (
      !workspace?.supported ||
      workspace.tenantId !== state.identity?.tenant_id
    ) {
      toast("Connect your company and refresh to choose workflows.");
      return;
    }
    const dialog = document.createElement("dialog");
    dialog.className = "workflow-dialog";
    const heading = document.createElement("h2");
    heading.textContent = "Your workflows";
    const intro = document.createElement("p");
    intro.textContent =
      "Choose the workflows your operator coordinates. Nothing starts automatically. Removing a workflow stops its background work. An owner/admin reviews changes.";
    const form = document.createElement("form");
    const options = document.createElement("div");
    options.className = "workflow-dialog-options";
    form.append(options);
    const choices = [];
    for (const pkg of workspace.catalog) {
      const label = document.createElement("label");
      label.className = "workflow-choice";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = workspace.packageKeys.includes(pkg.key);
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = pkg.title;
      const note = document.createElement("small");
      note.textContent = pkg.setupNote;
      text.append(title, note);
      label.append(check, text);
      options.append(label);
      choices.push({ key: pkg.key, check });
      if (workspace.recommendedPackageKeys.includes(pkg.key)) {
        const suggestion = document.createElement("small");
        suggestion.textContent =
          "Suggested by your website plan · not enabled automatically";
        text.append(suggestion);
      }
    }
    const fullLabel = document.createElement("label");
    fullLabel.className = "workflow-choice";
    const full = document.createElement("input");
    full.type = "checkbox";
    full.checked = workspace.mode === "full";
    fullLabel.append(
      full,
      document.createTextNode("Show the full workspace instead (advanced)"),
    );
    const advanced = document.createElement("details");
    const advancedTitle = document.createElement("summary");
    advancedTitle.textContent = "Advanced workspace options";
    const advancedNote = document.createElement("p");
    advancedNote.textContent =
      "Focused mode confines agent tools and stops existing work until it is assigned to an enabled workflow. Nothing is deleted. Full mode restores the compatible general workspace.";
    advanced.open = workspace.mode === "full";
    advanced.append(advancedTitle, advancedNote, fullLabel);
    options.append(advanced);
    for (const { check } of choices)
      check.addEventListener("change", () => {
        if (check.checked) full.checked = false;
      });
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    if (workspace.requiresReview)
      status.textContent =
        "Workflow capabilities changed. Review and approve the current catalog before continuing.";
    const save = document.createElement("button");
    save.className = "button primary";
    save.type = "submit";
    save.textContent = "Review workspace change";
    const canManage = ["owner", "admin"].includes(state.identity?.role);
    save.disabled = !canManage;
    if (!canManage)
      status.textContent = "An owner or admin can change company workflows.";
    const close = document.createElement("button");
    close.className = "button ghost";
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());
    const actions = document.createElement("div");
    actions.className = "workflow-dialog-actions";
    actions.append(status, save, close);
    form.append(actions);
    dialog.append(heading, intro, form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = "Preparing your configuration decision…";
      try {
        if (getState()?.identity?.tenant_id !== workspace.tenantId)
          throw new Error(
            "Your company changed. Reopen workflows before saving.",
          );
        const result = await api.setWorkflowWorkspace({
          mode: full.checked ? "full" : "focused",
          packageKeys: choices
            .filter((item) => item.check.checked)
            .map((item) => item.key),
          tenantId: workspace.tenantId,
          expectedRevision: workspace.revision,
          catalogSha256: workspace.catalogSha256,
        });
        if (getState()?.identity?.tenant_id !== workspace.tenantId)
          throw new Error(
            "Your company changed. Reopen workflows to review its current state.",
          );
        if (result?.status === "pending_approval") {
          status.textContent =
            "Your configuration change is ready for review. No work has started. ";
          const review = document.createElement("button");
          review.type = "button";
          review.className = "button ghost";
          review.textContent = "Review in Decisions →";
          review.addEventListener("click", () => {
            dialog.close();
            showView("work");
          });
          status.append(review);
          return;
        }
        await refresh();
        dialog.close();
        toast("Your workflow workspace is ready for setup.");
      } catch (error) {
        status.textContent = error.message;
      } finally {
        save.disabled = !canManage;
      }
    });
    dialog.showModal();
  }
  return { render, open };
}
