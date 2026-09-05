import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'output/router-boundary-20260905');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { validateRouterLearningReport } = await import(pathToFileURL(path.join(out, 'evaluation-source/src/research/routerLearningEvaluation.js')));
const { canonicalJson } = await import(pathToFileURL(path.join(out, 'evaluation-source/src/util/canonicalJson.js')));
const screen = await json(path.join(out, 'results.json'));
if (!screen.screenComplete) throw Error('Complete all screens first');
const protocol = await json(path.join(out, 'screen-protocol.json'));
if (sha(await readFile(path.join(root, 'research/router-boundary-20260905/evaluate.mjs'))) !== protocol.evaluationDriverSha256) throw Error('Frozen driver changed');
const plan = await json(path.join(out, 'evaluation-plan.json'));
for (const [file, digest] of Object.entries(plan.sourceHashes)) {
  if (sha(await readFile(path.join(out, 'evaluation-source', file))) !== digest) throw Error('Frozen evaluator changed');
}
const base = 'amos-router:0.8b-pilot003-v2';
const suites = ['evaluation', 'evaluation-context', 'regression', 'context'];
const classes = ['routine', 'balanced', 'deep', 'frontier'];
const rowsFor = (report, model, repetition) => report.runs.filter(row => row.modelId === model && row.repetition === repetition);
const score = rows => ({
  correct: rows.filter(row => row.correct).length,
  byClass: Object.fromEntries(classes.map(c => [c, rows.filter(row => row.expectedClass === c && row.correct).length])),
  severeUnderRoutes: rows.filter(row => row.severeUnderRoute).length,
  failedAttempts: rows.filter(row => row.status !== 'ok').length,
});
const results = [];
for (const candidate of screen.results.filter(row => row.passesAccuracyScreen)) {
  const name = candidate.model.replace('amos-router:0.8b-boundary-', '');
  const originalScreen = validateRouterLearningReport(await json(path.join(out, `${name}.screen.evaluation.report.json`)));
  const reports = {};
  const suiteResults = {};
  for (const suite of [...suites, 'training-probe']) {
    const report = validateRouterLearningReport(await json(path.join(out, `${name}.${suite}.report.json`)));
    if (canonicalJson(report.models) !== canonicalJson(originalScreen.models) || report.partition !== 'development' || !report.frozenCases) throw Error('Repeated comparison identity changed');
    for (const key of ['hardwareId', 'runtimeVersion', 'quantization', 'mode']) {
      if (report.environment[key] !== originalScreen.environment[key]) throw Error('Repeated runtime environment changed');
    }
    const repetitions = suite === 'training-probe' ? 1 : protocol.fullRepetitions;
    if (report.repetitions !== repetitions) throw Error('Unexpected repetition count');
    let cases = await json(path.join(out, plan.suites[suite].filename));
    if (sha(await readFile(path.join(out, plan.suites[suite].filename))) !== plan.suites[suite].sha256) throw Error('Frozen cases changed');
    if (suite === 'context') {
      const regressionIds = new Set((await json(path.join(out, plan.suites.regression.filename))).map(row => row.id));
      cases = cases.filter(row => !regressionIds.has(row.id));
    }
    if (canonicalJson(report.cases.map(({ payload, payloadSha256, ...row }) => row)) !== canonicalJson(cases)) throw Error('Report differs from frozen cases');
    const artifact = await json(path.join(out, 'exports', name, 'manifest.json'));
    const experiment = await json(path.join(out, 'experiment.json'));
    if (report.models.length !== 2 || report.models.find(row => row.id === candidate.model)?.artifactSha256 !== artifact.gguf_sha256 ||
        report.models.find(row => row.id === base)?.artifactSha256 !== experiment.baseCheckpoint.gguf_sha256) throw Error('Artifact mismatch');
    reports[suite] = report;
    suiteResults[suite] = {
      cases: cases.length, repetitions, reportDigest: report.digest,
      models: Object.fromEntries([base, candidate.model].map(model => [model, {
        scores: Array.from({ length: repetitions }, (_, repetition) => score(rowsFor(report, model, repetition))),
        stableAcrossRepetitions: cases.every(c => new Set(report.runs.filter(row => row.modelId === model && row.caseId === c.id).map(row => row.actualClass)).size === 1),
        latencyMs: report.metrics.byModel[model].latencyMs,
      }])),
    };
  }
  const repeatedChecks = Array.from({ length: protocol.fullRepetitions }, (_, repetition) => {
    const joint = model => {
      const continuation = new Map(rowsFor(reports['evaluation-context'], model, repetition).map(row => [row.caseId, row.correct]));
      return rowsFor(reports.evaluation, model, repetition).filter(row => row.correct && continuation.get(row.caseId + '-continuation')).length;
    };
    const baselineJoint = joint(base), candidateJoint = joint(candidate.model);
    return {
      repetition, baselineJoint, candidateJoint,
      freshJointTaskAccuracyImproved: candidateJoint > baselineJoint,
      noClassAccuracyRegression: suites.every(suite => classes.every(c => suiteResults[suite].models[candidate.model].scores[repetition].byClass[c] >= suiteResults[suite].models[base].scores[repetition].byClass[c])),
      noSevereUnderRouteIncrease: suites.every(suite => suiteResults[suite].models[candidate.model].scores[repetition].severeUnderRoutes <= suiteResults[suite].models[base].scores[repetition].severeUnderRoutes),
      noLegacyOrContextAggregateLoss: ['regression', 'context'].every(suite => suiteResults[suite].models[candidate.model].scores[repetition].correct >= suiteResults[suite].models[base].scores[repetition].correct),
      noFailedAttempts: suites.every(suite => [base, candidate.model].every(model => suiteResults[suite].models[model].scores[repetition].failedAttempts === 0)),
    };
  });
  const memory = await json(path.join(out, `${name}.memory.json`));
  const raw = await readFile(path.join(out, `${name}.memory.jsonl`));
  if (sha(raw) !== memory.evidenceSha256 || memory.evaluationExitCode !== 0) throw Error('Memory receipt mismatch');
  const samples = raw.toString().trim().split('\n').map(line => JSON.parse(line));
  if (!samples.length || samples.length !== memory.completePairedSamples) throw Error('Missing paired memory observations');
  const sampleGaps = samples.slice(1).map((row, index) => (Date.parse(row.at) - Date.parse(samples[index].at)) / 1000);
  if (sampleGaps.some(gap => !Number.isFinite(gap) || gap <= 0)) throw Error('Invalid memory sampling chronology');
  for (const model of reports.evaluation.models) {
    const recorded = memory.measurements.find(row => row.modelId === model.id);
    const peak = Math.max(...samples.map(row => row.models[model.id].rssBytes));
    if (recorded?.artifactSha256 !== model.artifactSha256 || recorded.peakRssBytes !== peak || peak <= 0) throw Error('Memory observation mismatch');
  }
  results.push({
    seed: candidate.seed, arm: candidate.arm, model: candidate.model,
    repeatedChecks,
    passesRepeatedAccuracyChecks: repeatedChecks.every(({ repetition, baselineJoint, candidateJoint, ...checks }) => Object.values(checks).every(Boolean)),
    largestWarmP95Ratio: Math.max(...suites.map(suite => suiteResults[suite].models[candidate.model].latencyMs.p95 / suiteResults[suite].models[base].latencyMs.p95)),
    sampledPeakRssRatio: memory.measurements.find(row => row.modelId === candidate.model).peakRssBytes / memory.measurements.find(row => row.modelId === base).peakRssBytes,
    maximumMemorySamplingGapSeconds: sampleGaps.length ? Math.max(...sampleGaps) : null,
    memory, suites: suiteResults,
  });
}
const summary = {
  schema: 'amos.router-boundary-repeated-measurements', version: 1,
  generatedAt: new Date().toISOString(), qualification: false, productionChanged: false,
  screenRecipeSupported: screen.recipeSupported, results,
  claimBoundary: 'Post-screen repeated development measurements on the same 72 fresh tasks and older diagnostics. Repetitions measure stability and timing; they add no independent tasks. Sampled runner-tree RSS excludes the shared daemon and is not total unified-memory accounting. Independent qualification is still required.',
};
await writeFile(path.join(out, 'repeated-results.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
