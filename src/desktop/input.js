export function shouldSubmitPrompt(event) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
