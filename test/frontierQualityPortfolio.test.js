import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  frontierQualityPortfolioDigest,
  validateFrontierQualityPortfolio
} from "../src/research/frontierQualityPortfolio.js";

const portfolioUrl = new URL(
  "../benchmarks/frontier-quality-portfolio-v1.json",
  import.meta.url
);

test("the frontier quality portfolio requires broad blind comparison against Fable", async () => {
  const portfolio = validateFrontierQualityPortfolio(
    JSON.parse(await readFile(portfolioUrl, "utf8"))
  );
  assert.equal(portfolio.promotion.frontierControlId, "fable-control");
  assert.equal(portfolio.promotion.maximumSignificantTrackLosses, 0);
  assert.equal(portfolio.promotion.requireBlindJudging, true);
  assert.equal(
    portfolio.tracks.filter((track) => track.countsTowardFrontierWin).length,
    8
  );
  assert.match(frontierQualityPortfolioDigest(portfolio), /^[a-f0-9]{64}$/);
});

test("the portfolio rejects a frontier claim without a time-separated control", async () => {
  const portfolio = JSON.parse(await readFile(portfolioUrl, "utf8"));
  for (const track of portfolio.tracks) track.source.timeSeparated = false;
  assert.throws(
    () => validateFrontierQualityPortfolio(portfolio),
    /time-separated contamination control/
  );
});

test("the portfolio cannot freeze before every required adapter is ready", async () => {
  const portfolio = JSON.parse(await readFile(portfolioUrl, "utf8"));
  portfolio.status = "frozen";
  assert.throws(
    () => validateFrontierQualityPortfolio(portfolio),
    /planned required tracks/
  );
});
