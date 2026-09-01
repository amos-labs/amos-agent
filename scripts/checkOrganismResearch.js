#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const files = [
  "src/research/amosNativeTrainingDataset.js",
  "src/research/amosOwnedMissionArena.js",
  "src/research/amosSyntheticCurriculum.js",
  "src/research/dualChannelHolographicExperiment.js",
  "src/research/dualChannelHolographicWorld.js",
  "src/research/holographicSwarmKernel.js",
  "src/research/holographicWorldV2.js",
  "src/research/holographicWorldV2Experiment.js",
  "src/research/organismContracts.js",
  "src/research/processMiningOrganismCurriculum.js",
  "src/research/qwenAdapterTrainingContract.js",
  "src/research/swarmOrganismArtifactReplay.js",
  "src/research/swarmOrganismLearningCycle.js",
  "src/research/swarmOrganismQwenPhaseProbe.js",
  "src/research/swarmOrganismSimulator.js",
  "src/research/swarmProcedureExtraction.js",
  "src/research/swarmTaskCoordinator.js",
  "scripts/exportOrganismTraceBundle.js",
];

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
