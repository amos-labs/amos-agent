import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  WINDOWS_AZURE_SIGNING_ENV,
  createWindowsAzureSigningConfig
} = require("../desktop/windowsAzureSigningConfig.cjs");

const validEnvironment = {
  AZURE_TENANT_ID: "tenant-id",
  AZURE_CLIENT_ID: "client-id",
  AZURE_CLIENT_SECRET: "client-secret",
  WINDOWS_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
  WINDOWS_SIGNING_ACCOUNT_NAME: "amoslabs",
  WINDOWS_SIGNING_CERTIFICATE_PROFILE_NAME: "amos-desktop-public",
  WINDOWS_SIGNING_PUBLISHER_NAME: "CN=AMOS Labs LLC"
};

test("Windows Artifact Signing config maps the exact managed identity values", () => {
  assert.deepEqual(createWindowsAzureSigningConfig(validEnvironment), {
    extends: "./desktop/electron-builder.release.yml",
    win: {
      azureSignOptions: {
        publisherName: "CN=AMOS Labs LLC",
        endpoint: "https://eus.codesigning.azure.net/",
        certificateProfileName: "amos-desktop-public",
        codeSigningAccountName: "amoslabs"
      }
    }
  });
});

test("Windows Artifact Signing config fails closed and names every missing value", () => {
  assert.throws(
    () => createWindowsAzureSigningConfig({}),
    (error) => Object.values(WINDOWS_AZURE_SIGNING_ENV)
      .every((name) => error.message.includes(name))
  );
});

test("Windows Artifact Signing config rejects a malformed endpoint", () => {
  assert.throws(
    () => createWindowsAzureSigningConfig({
      ...validEnvironment,
      WINDOWS_SIGNING_ENDPOINT: "http://eus.codesigning.azure.net"
    }),
    /HTTPS URL ending in \/$/
  );
});
