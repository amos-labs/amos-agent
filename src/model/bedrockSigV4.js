import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

export const BEDROCK_AUTH_MODES = Object.freeze({
  API_KEY: "api-key",
  SIGV4: "sigv4"
});

export function resolveBedrockAuthMode(value, apiKey = "") {
  const requested = String(value || "auto").trim().toLowerCase();
  if (requested === "auto") {
    return apiKey ? BEDROCK_AUTH_MODES.API_KEY : BEDROCK_AUTH_MODES.SIGV4;
  }
  if (!Object.values(BEDROCK_AUTH_MODES).includes(requested)) {
    throw new Error(`Unsupported Amazon Bedrock authentication mode: ${requested}`);
  }
  return requested;
}

export function createBedrockSigV4Signer({ region, credentials } = {}) {
  const normalizedRegion = String(region || "").trim();
  if (!normalizedRegion) throw new Error("Amazon Bedrock SigV4 requires an AWS region");
  const credentialProvider = credentials || fromNodeProviderChain({
    clientConfig: { region: normalizedRegion }
  });
  const signer = new SignatureV4({
    credentials: credentialProvider,
    region: normalizedRegion,
    service: "bedrock-mantle",
    sha256: Hash.bind(null, "sha256")
  });

  return async function signBedrockRequest({ url, method = "POST", headers = {}, body = "" }) {
    const endpoint = new URL(url);
    assertMantleSigningTarget(endpoint, normalizedRegion);
    let signed;
    try {
      signed = await signer.sign(new HttpRequest({
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        method,
        path: endpoint.pathname,
        query: Object.fromEntries(endpoint.searchParams),
        headers: {
          ...headers,
          host: endpoint.host
        },
        body
      }));
    } catch (error) {
      throw credentialError(error);
    }
    return {
      headers: signed.headers,
      method: signed.method,
      body: signed.body
    };
  };
}

function assertMantleSigningTarget(url, region) {
  const expectedHost = `bedrock-mantle.${region}.api.aws`;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname !== expectedHost
  ) {
    throw new Error(`Amazon Bedrock SigV4 can only sign ${expectedHost}`);
  }
}

function credentialError(error) {
  const message = String(error?.message || "");
  if (/credential|profile|sso|token|access key/i.test(message)) {
    return new Error(
      "Amazon Bedrock AWS credentials are unavailable or expired. Sign in with AWS SSO, configure an AWS profile, attach an IAM role, or choose Bedrock API key authentication."
    );
  }
  return new Error(`Amazon Bedrock could not sign the request: ${message || "unknown signing error"}`);
}
