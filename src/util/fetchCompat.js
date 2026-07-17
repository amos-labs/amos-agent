import http from "node:http";
import https from "node:https";

export async function fetchCompat(url, options = {}) {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch(url, options);
  }

  return nodeFetch(url, options);
}

function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const method = options.method || "GET";
    const headers = options.headers || {};
    const body = options.body || null;

    const request = transport.request(
      parsed,
      {
        method,
        headers
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const headerMap = new Map(
            Object.entries(response.headers).map(([key, value]) => [
              key.toLowerCase(),
              Array.isArray(value) ? value.join(", ") : String(value || "")
            ])
          );

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            url: parsed.toString(),
            headers: {
              get(name) {
                return headerMap.get(String(name).toLowerCase()) || null;
              }
            },
            async text() {
              return buffer.toString("utf8");
            },
            async json() {
              return JSON.parse(buffer.toString("utf8"));
            }
          });
        });
      }
    );

    request.on("error", reject);

    if (options.signal) {
      if (options.signal.aborted) {
        request.destroy(new Error("Request aborted"));
        return;
      }
      options.signal.addEventListener(
        "abort",
        () => {
          request.destroy(new Error("Request aborted"));
        },
        { once: true }
      );
    }

    if (body) request.write(body);
    request.end();
  });
}
