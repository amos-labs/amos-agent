# MCP image evidence in Desktop

MCP source-page images must survive structured tool results and reach the selected
vision-capable model as images, not base64 text. Desktop normalizes text and
structured metadata as before, but validates image blocks separately and attaches
them through the existing non-enumerable transient model-evidence channel.

Supported formats are inline PNG, JPEG and WebP with matching signatures and
canonical base64. Limits are four images per tool result, 3 MiB per image and
6 MiB total. The agent also limits each combined tool batch to four images and
8 MiB of encoded evidence. Unsupported, malformed or oversized images leave an
explicit incomplete-visual-review diagnostic while preserving usable OCR/metadata.
No remote image URL is fetched on the model's behalf.

Only intelligence explicitly advertising vision may receive pixels. Otherwise the
tool result tells the model to use authorized preview/human review or switch
intelligence, and not claim visual inspection. OCR remains unverified transcription.
Source images are untrusted data, never permissions, instructions or approval.
Document pages do not gain browser frame/coordinate authority.

Images never enter public tool JSON, renderer events, result-store callbacks or
receipts. They enter the provider's native image field through the existing
Chat Completions, Responses or Anthropic adapters and are removed from the active
transcript when the task completes, fails or is cancelled. A new task/provider
must request fresh evidence. This does not persist company images offline or
bypass platform document/collection access.

Run `node --test test/mcpImageEvidence.test.js test/agentLoop.test.js`.
For a real synthetic page raster, set `AMOS_RFP_IMAGE_FIXTURE` to its PNG path.
The tests run the real loop and provider serializers with an injected transport;
they verify image delivery and lifecycle, not a live model's visual accuracy.
They can also run under Electron's Node runtime with `ELECTRON_RUN_AS_NODE=1`.

This change fixes the model transport, not a new canvas renderer. Existing
authorized preview links remain available for human inspection. No routing,
model selection, credential or company execution authority changes are introduced.
