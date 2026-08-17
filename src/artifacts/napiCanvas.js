// Lazy loader for @napi-rs/canvas.
//
// The native binding lives in a per-platform optional dependency
// (@napi-rs/canvas-<platform>-<arch>). A desktop build that ships the wrong
// arch (or none) must degrade artifact rendering with a clear error instead of
// crashing the Electron main process at startup. Every canvas consumer loads
// through loadNapiCanvas() so the module is only resolved when a render is
// actually requested, and a missing binding surfaces as a typed, actionable
// error rather than an uncaught "Cannot find native binding" at boot.

let canvasModulePromise = null;

function nativeBindingError(cause) {
  const error = new Error(
    "The native canvas engine is unavailable in this build, so chart and " +
      "preview rendering is disabled. Reinstall AMOS Desktop or upgrade to a " +
      "build that includes the canvas binary for your platform."
  );
  error.code = "AMOS_CANVAS_NATIVE_UNAVAILABLE";
  error.cause = cause;
  return error;
}

export async function loadNapiCanvas() {
  if (!canvasModulePromise) {
    canvasModulePromise = import("@napi-rs/canvas").catch((cause) => {
      // Reset so a later call (e.g. after an update installs the binding) can retry.
      canvasModulePromise = null;
      throw nativeBindingError(cause);
    });
  }
  return canvasModulePromise;
}

export async function createCanvas(width, height) {
  const { createCanvas: create } = await loadNapiCanvas();
  return create(width, height);
}

export async function loadImage(source) {
  const { loadImage: load } = await loadNapiCanvas();
  return load(source);
}
