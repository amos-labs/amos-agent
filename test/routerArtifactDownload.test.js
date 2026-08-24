import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artifactRequestHeaders,
  downloadRouterArtifactToFile,
  fetchRouterArtifact,
  isGitHubCdnHost,
  parseGitHubReleaseDownloadUrl
} from "../scripts/routerArtifactDownload.js";

test("GitHub app hosts get a bearer token and octet-stream accept, CDN hosts do not", () => {
  const token = "ghs_test_token";
  const github = artifactRequestHeaders(new URL("https://github.com/amos-labs/private/releases/download/v1/model.gguf"), token);
  const api = artifactRequestHeaders(new URL("https://api.github.com/repos/amos-labs/private/releases/assets/1"), token);
  const cdn = artifactRequestHeaders(
    new URL("https://release-assets.githubusercontent.com/github-production-release-asset/1"),
    token
  );

  assert.equal(github.authorization, "Bearer ghs_test_token");
  assert.equal(github.accept, "application/octet-stream");
  assert.equal(api.authorization, "Bearer ghs_test_token");
  assert.equal(cdn.authorization, undefined);
  assert.equal(isGitHubCdnHost("release-assets.githubusercontent.com"), true);
  assert.equal(isGitHubCdnHost("objects.githubusercontent.com"), true);
});

test("GitHub release download URLs parse owner, repo, tag, and filename", () => {
  const parsed = parseGitHubReleaseDownloadUrl(
    new URL("https://github.com/amos-labs/models/releases/download/router-v1/amos-router-q4_k_m.gguf")
  );
  assert.deepEqual(parsed, {
    owner: "amos-labs",
    repo: "models",
    tag: "router-v1",
    file: "amos-router-q4_k_m.gguf"
  });
  assert.equal(
    parseGitHubReleaseDownloadUrl(new URL("https://objects.githubusercontent.com/github-production-release-asset/1")),
    null
  );
});

test("a 403 on an authenticated GitHub asset URL retries without the bearer token", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), authorization: init.headers?.authorization || null, redirect: init.redirect || null });
    if (url.hostname === "github.com" && init.headers?.authorization) {
      return new Response(null, { status: 403 });
    }
    if (url.hostname === "github.com") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://release-assets.githubusercontent.com/asset?sig=1" }
      });
    }
    return new Response("ok", { status: 200, headers: { "content-length": "2" } });
  };

  const response = await fetchRouterArtifact(
    "https://github.com/amos-labs/models/releases/download/v1/model.gguf",
    { fetchImpl, token: "" }
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, null);
});

test("an authenticated GitHub browser URL that 403s is retried without auth, then follows the CDN redirect", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      host: url.hostname,
      authorization: init.headers?.authorization || null,
      accept: init.headers?.accept || null
    });
    if (url.hostname === "api.github.com") {
      return new Response("nope", { status: 403 });
    }
    if (url.hostname === "github.com" && init.headers?.authorization) {
      return new Response(null, { status: 403 });
    }
    if (url.hostname === "github.com") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://release-assets.githubusercontent.com/asset?sig=1" }
      });
    }
    assert.equal(init.headers?.authorization, undefined);
    return new Response("gg", { status: 200 });
  };

  const response = await fetchRouterArtifact(
    "https://github.com/amos-labs/models/releases/download/v1/model.gguf",
    { fetchImpl, token: "ghs_test_token" }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((call) => call.host),
    ["api.github.com", "github.com", "github.com", "release-assets.githubusercontent.com"]
  );
  assert.equal(calls[1].authorization, "Bearer ghs_test_token");
  assert.equal(calls[2].authorization, null);
  assert.equal(calls[3].authorization, null);
});

test("GitHub release API downloads use the asset endpoint and strip auth on the CDN hop", async () => {
  const payload = Buffer.from("router-bytes");
  const digest = createHash("sha256").update(payload).digest("hex");
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      authorization: init.headers?.authorization || null,
      accept: init.headers?.accept || null
    });
    if (url.hostname === "api.github.com" && url.pathname.endsWith("/releases/tags/router-v1")) {
      return Response.json({
        assets: [
          {
            name: "model.gguf",
            url: "https://api.github.com/repos/amos-labs/models/releases/assets/99"
          }
        ]
      });
    }
    if (url.pathname.endsWith("/releases/assets/99")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://release-assets.githubusercontent.com/asset?sig=1" }
      });
    }
    assert.equal(url.hostname, "release-assets.githubusercontent.com");
    assert.equal(init.headers?.authorization, undefined);
    return new Response(payload, {
      status: 200,
      headers: { "content-length": String(payload.length) }
    });
  };

  const dir = await mkdtemp(join(tmpdir(), "amos-router-dl-"));
  const destination = join(dir, "model.gguf");
  try {
    await downloadRouterArtifactToFile(
      "https://github.com/amos-labs/models/releases/download/router-v1/model.gguf",
      destination,
      { gguf_size_bytes: payload.length, gguf_sha256: digest },
      { fetchImpl, token: "ghs_test_token" }
    );
    assert.equal(await readFile(destination, "utf8"), "router-bytes");
    assert.equal(calls[0].accept, "application/vnd.github+json");
    assert.equal(calls[1].accept, "application/octet-stream");
    assert.equal(calls[2].authorization, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTPS is required for router artifact URLs", async () => {
  await assert.rejects(
    () => fetchRouterArtifact("http://example.test/model.gguf", { fetchImpl: async () => new Response(null), token: "" }),
    /must use HTTPS/
  );
});
