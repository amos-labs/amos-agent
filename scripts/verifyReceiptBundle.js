#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyEvidencePack } from "../src/desktop/localReceiptStore.js";

const filePath = process.argv[2];
if (!filePath || filePath.startsWith("-")) {
  console.error("Usage: node scripts/verifyReceiptBundle.js <pack.json>");
  process.exit(2);
}

let pack;
try {
  pack = JSON.parse(await readFile(filePath, "utf8"));
} catch (error) {
  console.error(`Could not read evidence pack: ${error.message}`);
  process.exit(2);
}

const result = verifyEvidencePack(pack);
for (const item of result.items) {
  const digest = item.kind === "desktop-local" ? ` digest=${item.digest}` : "";
  console.log(`${item.index + 1}. ${item.kind || "unknown"} ${item.id || "—"}${digest}`);
}
for (const error of result.errors) {
  console.error(`error: ${error}`);
}
if (!result.ok) {
  console.error(`Invalid evidence pack (${result.errors.length} error(s)).`);
  process.exit(1);
}
console.log(`ok ${result.items.length} item(s)`);
