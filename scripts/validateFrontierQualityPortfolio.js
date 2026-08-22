#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  frontierQualityPortfolioDigest,
  validateFrontierQualityPortfolio
} from "../src/research/frontierQualityPortfolio.js";

const path = process.argv[2] || new URL(
  "../benchmarks/frontier-quality-portfolio-v1.json",
  import.meta.url
);
const portfolio = validateFrontierQualityPortfolio(
  JSON.parse(await readFile(path, "utf8"))
);
const frontierTracks = portfolio.tracks.filter(
  (track) => track.required && track.countsTowardFrontierWin
);
const readyTracks = portfolio.tracks.filter(
  (track) => track.executionStatus === "ready"
);

console.log(`Portfolio: ${portfolio.id} (${portfolio.status})`);
console.log(`Controls: ${portfolio.controls.map((control) => control.id).join(", ")}`);
console.log(`Frontier quality tracks: ${frontierTracks.length}`);
console.log(`Adapters ready: ${readyTracks.length}/${portfolio.tracks.length}`);
console.log(`Digest: ${frontierQualityPortfolioDigest(portfolio)}`);
