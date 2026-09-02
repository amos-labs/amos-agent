import { truncateText } from "../util/pathSafety.js";
import { fetchCompat } from "../util/fetchCompat.js";
import { linkAbortSignal } from "../util/abort.js";
import { assertPublicUrl } from "../util/publicUrl.js";
import { boundedNumber } from "../util/validate.js";

export { assertPublicUrl, isPrivateAddress } from "../util/publicUrl.js";

export function createWebTools() {
  return [
    {
      name: "web_fetch",
      source: "local",
      description: "Fetch a public HTTP/HTTPS URL and return a compact text view.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "HTTP or HTTPS URL." },
          max_bytes: { type: "integer", description: "Maximum bytes of text to return." }
        },
        required: ["url"],
        additionalProperties: false
      },
      async handler(args, context) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        const unlink = linkAbortSignal(context.signal, controller);
        try {
          const maxBytes = boundedNumber(args.max_bytes, context.config.safety.maxOutputBytes, 1, context.config.safety.maxOutputBytes);
          const { response, finalUrl } = await fetchPublicUrl(args.url, { signal: controller.signal });
          const contentType = response.headers.get("content-type") || "";
          const raw = await readBoundedText(response, maxBytes);
          const text = contentType.includes("html") ? htmlToText(raw) : raw;
          return {
            ok: response.ok,
            status: response.status,
            url: finalUrl,
            content_type: contentType,
            content: truncateText(text, maxBytes)
          };
        } finally {
          clearTimeout(timeout);
          unlink();
        }
      }
    },
    {
      name: "web_search",
      source: "local",
      description: "Search the web with Brave Search if BRAVE_SEARCH_API_KEY is configured.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          count: { type: "integer", description: "Number of results, 1-10." }
        },
        required: ["query"],
        additionalProperties: false
      },
      async handler(args, context) {
        if (!context.config.search.braveApiKey) {
          return {
            ok: false,
            message: "Native web_search requires BRAVE_SEARCH_API_KEY. Use web_fetch for known URLs."
          };
        }

        const params = new URLSearchParams({
          q: String(args.query),
          count: String(Math.min(Math.max(Number(args.count || 5), 1), 10))
        });
        const response = await fetchCompat(`https://api.search.brave.com/res/v1/web/search?${params}`, {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": context.config.search.braveApiKey
          },
          signal: context.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message || `Brave Search failed with ${response.status}`);
        }

        return {
          ok: true,
          results: (payload.web?.results || []).map((result) => ({
            title: result.title,
            url: result.url,
            description: result.description
          }))
        };
      }
    }
  ];
}

export async function fetchPublicUrl(value, { signal, maxRedirects = 5, fetchImpl = fetchCompat } = {}) {
  let url = new URL(value);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicUrl(url);
    const response = await fetchImpl(url, { signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: url.toString() };
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect response did not include a location");
    if (redirect === maxRedirects) throw new Error("Too many redirects");
    url = new URL(location, url);
  }
  throw new Error("Too many redirects");
}

async function readBoundedText(response, maxBytes) {
  if (!response.body?.getReader) return truncateText(await response.text(), maxBytes);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - bytes;
    const chunk = Buffer.from(value).subarray(0, remaining);
    chunks.push(chunk);
    bytes += chunk.length;
    if (chunk.length < value.length) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}


function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
