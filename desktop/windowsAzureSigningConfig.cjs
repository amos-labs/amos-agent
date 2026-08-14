"use strict";

const WINDOWS_AZURE_SIGNING_ENV = Object.freeze({
  tenantId: "AZURE_TENANT_ID",
  clientId: "AZURE_CLIENT_ID",
  clientSecret: "AZURE_CLIENT_SECRET",
  endpoint: "WINDOWS_SIGNING_ENDPOINT",
  accountName: "WINDOWS_SIGNING_ACCOUNT_NAME",
  certificateProfileName: "WINDOWS_SIGNING_CERTIFICATE_PROFILE_NAME",
  publisherName: "WINDOWS_SIGNING_PUBLISHER_NAME"
});

function createWindowsAzureSigningConfig(environment = process.env) {
  const values = {};
  const missing = [];

  for (const [key, name] of Object.entries(WINDOWS_AZURE_SIGNING_ENV)) {
    const value = typeof environment[name] === "string"
      ? environment[name].trim()
      : "";
    if (!value) missing.push(name);
    values[key] = value;
  }

  if (missing.length > 0) {
    throw new Error(`Missing Windows Artifact Signing configuration: ${missing.join(", ")}`);
  }

  if (!values.endpoint.startsWith("https://") || !values.endpoint.endsWith("/")) {
    throw new Error("WINDOWS_SIGNING_ENDPOINT must be an HTTPS URL ending in /");
  }

  return {
    extends: "./desktop/electron-builder.release.yml",
    win: {
      azureSignOptions: {
        publisherName: values.publisherName,
        endpoint: values.endpoint,
        certificateProfileName: values.certificateProfileName,
        codeSigningAccountName: values.accountName
      }
    }
  };
}

module.exports = {
  WINDOWS_AZURE_SIGNING_ENV,
  createWindowsAzureSigningConfig
};
