import { fetchCompat } from "../util/fetchCompat.js";
import { createBedrockSigV4Signer } from "./bedrockSigV4.js";

export async function configureBedrockProviderDataSharing(config, fetchImpl = fetchCompat) {
  if (config?.provider !== "bedrock") {
    throw new Error("Provider data sharing can only be configured for Amazon Bedrock");
  }
  if (config?.modelProfile?.dataRetention?.requiredMode !== "provider_data_share") {
    throw new Error("The selected Amazon Bedrock model does not require provider data sharing");
  }
  const endpoint = new URL(config.baseUrl);
  endpoint.pathname = "/v1/data_retention";
  endpoint.search = "";
  endpoint.hash = "";
  const body = JSON.stringify({ mode: "provider_data_share" });
  let request = {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(config.authMode === "sigv4" ? {} : { "x-api-key": config.apiKey })
    },
    body
  };
  const signRequest = config.signRequest || (config.authMode === "sigv4"
    ? createBedrockSigV4Signer({
        region: config.awsRegion,
        credentials: config.awsCredentialProvider
      })
    : null);
  if (typeof signRequest === "function") {
    request = {
      ...request,
      ...(await signRequest({ url: endpoint.toString(), ...request }))
    };
  }
  const response = await fetchImpl(endpoint.toString(), request);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text ||
      `Amazon Bedrock data retention update failed with ${response.status}`;
    throw new Error(message);
  }
  if (payload.mode !== "provider_data_share") {
    throw new Error("Amazon Bedrock did not confirm provider data sharing");
  }
  return {
    mode: payload.mode,
    updatedAt: payload.updated_at || null
  };
}

export function bedrockRetentionActionableError(config, message) {
  const value = String(message || "");
  if (
    config?.provider !== "bedrock" ||
    config?.modelProfile?.dataRetention?.requiredMode !== "provider_data_share" ||
    !/data retention mode|provider_data_share/i.test(value)
  ) {
    return value;
  }
  const label = config.modelProfile.label || config.model;
  return `${label} requires an explicit Amazon Bedrock provider-data-sharing opt-in. Open Intelligence settings, review the retention notice, and choose Enable provider data sharing—or select a model that does not require sharing.`;
}
