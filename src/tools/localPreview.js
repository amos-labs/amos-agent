import { workspaceFocusPath } from "../util/workspaceFocus.js";
export function createLocalPreviewTool({ preview, browser, scope, present = null } = {}) {
  if (!preview || !browser) throw new Error("Local preview requires preview and browser runtimes");
  if (typeof scope !== "function") throw new Error("Local preview requires a task scope provider");
  return {
    name: "desktop_preview_app",
    source: "desktop-local",
    description:
      "Serve a generated HTML/CSS/JavaScript app from the selected workspace on an isolated exact loopback origin, open it in the governed browser canvas, and return a visual/semantic observation. Use this instead of background servers, file URLs, or browser_open with localhost.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative HTML file or static-site directory. Defaults to the workspace root."
        }
      }
    },
    async handler(args, context) {
      const currentScope = scope();
      const started = await preview.start(currentScope, {
        workspace: workspaceFocusPath(context.config.safety),
        path: args.path || ".",
        signal: context.signal
      });
      browser.grantLocalPreview(currentScope, { origin: started.origin });
      try {
        const observation = await browser.open(currentScope, {
          url: started.url,
          signal: context.signal
        });
        const previewDetails = {
          root: started.root,
          entry: started.entry,
          origin: started.origin,
          network: started.network
        };
        const canvas = typeof present === "function"
          ? await present({ ...observation, operation: "local_preview", preview: previewDetails })
          : null;
        return {
          ...observation,
          preview: previewDetails,
          ...(canvas?.id ? { canvas_id: canvas.id } : {})
        };
      } catch (error) {
        browser.revokeLocalPreview(currentScope, { origin: started.origin });
        await preview.close(currentScope).catch(() => {});
        throw error;
      }
    }
  };
}
