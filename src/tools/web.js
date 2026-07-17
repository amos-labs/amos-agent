import { truncateText } from "../util/pathSafety.js";
import { fetchCompat } from "../util/fetchCompat.js";

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
        const url = new URL(args.url);
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("Only http and https URLs are allowed");
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetchCompat(url, { signal: controller.signal });
          const contentType = response.headers.get("content-type") || "";
          const raw = await response.text();
          const text = contentType.includes("html") ? htmlToText(raw) : raw;
          return {
            ok: response.ok,
            status: response.status,
            url: response.url,
            content_type: contentType,
            content: truncateText(text, Number(args.max_bytes || context.config.safety.maxOutputBytes))
          };
        } finally {
          clearTimeout(timeout);
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
          }
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
