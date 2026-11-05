import { workspaceUpdate } from "./workflowWorkspace.js";

// Owns only the workflow projection lifecycle. Company truth and execution
// authority remain in Platform; personal/local runtime is a separate path.
export class WorkflowWorkspaceSession {
  constructor({ onChange = () => {} } = {}) {
    this.current = null;
    this.onChange = onChange;
    this.generation = 0;
  }

  update(value) {
    if (value === null || value?.tenantId !== this.current?.tenantId)
      this.generation += 1;
    const authority = (workspace) =>
      workspace
        ? [
            workspace.supported,
            workspace.tenantId,
            workspace.mode,
            workspace.revision,
            workspace.catalogSha256,
            workspace.requiresReview,
            workspace.packageKeys,
          ]
        : null;
    const before = JSON.stringify(authority(this.current));
    this.current = value;
    if (JSON.stringify(authority(value)) !== before) this.onChange();
  }

  async refresh(remote, identity) {
    if (typeof remote.workflowWorkspace !== "function") {
      this.update(null);
      return;
    }
    const generation = this.generation;
    try {
      const value = await remote.workflowWorkspace(null);
      if (this.generation === generation) this.update(value);
    } catch (error) {
      if (this.generation !== generation) return;
      if (this.current?.tenantId !== identity?.tenant_id) this.update(null);
      throw error;
    }
  }

  async save(input, { getIdentity, getRemote, refresh }) {
    const identity = getIdentity();
    const request = workspaceUpdate(this.current, identity, input);
    const remote = await getRemote();
    if (getIdentity()?.tenant_id !== identity.tenant_id)
      throw new Error("The company changed. Reopen workflows before saving.");
    const result = await remote.setWorkflowWorkspace(request);
    if (getIdentity()?.tenant_id === identity.tenant_id) await refresh();
    return result;
  }
}
