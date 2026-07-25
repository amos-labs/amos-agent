import { OpenAICompatibleClient } from "./openAiCompatibleClient.js";

// Backwards-compatible export for consumers that imported the original client.
// New code should use createModelClient() from providers.js.
export class KimiClient extends OpenAICompatibleClient {}
