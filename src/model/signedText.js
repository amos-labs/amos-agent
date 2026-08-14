import { createHash } from "node:crypto";

export function canonicalizeSignedText(value) {
  if (typeof value !== "string") {
    throw new TypeError("Signed text must be a string");
  }
  return value.replace(/\r\n?/g, "\n");
}

export function signedTextSha256(value) {
  return createHash("sha256")
    .update(canonicalizeSignedText(value), "utf8")
    .digest("hex");
}
