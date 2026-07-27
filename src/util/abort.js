export function createAbortError(message = "Task canceled") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "AMOS_TASK_CANCELED";
  return error;
}

export function throwIfAborted(signal, message = "Task canceled") {
  if (signal?.aborted) throw createAbortError(message);
}

export function linkAbortSignal(signal, controller) {
  if (!signal) return () => {};
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    abort();
    return () => {};
  }
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "AMOS_TASK_CANCELED";
}
