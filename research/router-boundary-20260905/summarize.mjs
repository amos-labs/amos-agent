import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'output/router-boundary-20260905');
const {validateRouterLearningReport}=await import(pathToFileURL(path.join(out,'evaluation-source/src/research/routerLearningEvaluation.js')));
const {canonicalJson}=await import(pathToFileURL(path.join(out,'evaluation-source/src/util/canonicalJson.js')));
const classes=['routine','balanced','deep','frontier'];
const baseline='amos-router:0.8b-pilot003-v2';
const suites=['evaluation','evaluation-context','regression','context'];
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const experiment=await json(path.join(out,'experiment.json'));
const protocol=await json(path.join(out,'screen-protocol.json'));
const hash=x=>createHash('sha256').update(x).digest('hex');
if(hash(await readFile(fileURLToPath(import.meta.url)))!==protocol.summarizerSha256)throw Error('Summarizer differs from the frozen protocol');
if(hash(await readFile(path.join(root,'research/router-boundary-20260905/evaluate.mjs')))!==protocol.evaluationDriverSha256)throw Error('Evaluation driver differs from the frozen protocol');
const evaluationPlan=await json(path.join(out,'evaluation-plan.json'));
if(hash(await readFile(path.join(out,'experiment.json')))!==evaluationPlan.sourceExperimentSha256)throw Error('Experiment changed');
for(const [file,digest] of Object.entries(evaluationPlan.sourceHashes))if(hash(await readFile(path.join(out,'evaluation-source',file)))!==digest)throw Error('Frozen evaluator changed');
for(const suite of Object.values(evaluationPlan.suites))if(hash(await readFile(path.join(out,suite.filename)))!==suite.sha256)throw Error('Frozen cases changed');
const results=[];
const baselinePredictions=new Map();
const points=(report,model)=>new Map(report.runs.filter(r=>r.modelId===model&&r.repetition===0).map(r=>[r.caseId,r]));
function summarize(report,model){
  const rows=[...points(report,model).values()];
  const stability=rows.every(row=>new Set(report.runs.filter(r=>r.modelId===model&&r.caseId===row.caseId).map(r=>r.actualClass)).size===1);
  return {cases:rows.length,correct:rows.filter(r=>r.correct).length,stableAcrossRepetitions:stability,byClass:Object.fromEntries(classes.map(c=>[c,{total:rows.filter(r=>r.expectedClass===c).length,correct:rows.filter(r=>r.expectedClass===c&&r.correct).length}])),underRoutes:rows.filter(r=>r.underRoute).length,severeUnderRoutes:rows.filter(r=>r.severeUnderRoute).length,failedAttempts:report.runs.filter(r=>r.modelId===model&&r.status!=='ok').length,latencyMs:report.metrics.byModel[model].latencyMs};
}
function paired(report,model){
  const base=points(report,baseline),candidate=points(report,model);
  return {wins:[...candidate].filter(([id,r])=>r.correct&&!base.get(id).correct).map(([id])=>id),losses:[...candidate].filter(([id,r])=>!r.correct&&base.get(id).correct).map(([id])=>id)};
}
function joint(reports,model){
  const single=points(reports.evaluation,model),context=points(reports['evaluation-context'],model);
  return new Map([...single].map(([id,r])=>[id,r.correct&&context.get(id+'-continuation').correct]));
}
for(const seed of experiment.seeds){
  for(const arm of ['control','learning']){
    const name=`${arm}-${seed}`,model=`amos-router:0.8b-boundary-${name}`;
    const reports={};
    let missing=false;
    for(const suite of suites){
      try{reports[suite]=validateRouterLearningReport(await json(path.join(out,`${name}.screen.${suite}.report.json`)));}
      catch(error){if(error.code==='ENOENT'){missing=true;break;}throw error;}
      if(!reports[suite].models.some(m=>m.id===model)||!reports[suite].models.some(m=>m.id===baseline))throw Error('Unexpected comparison models');
      const artifact=await json(path.join(out,'exports',name,'manifest.json'));
      if(reports[suite].models.find(m=>m.id===model).artifactSha256!==artifact.gguf_sha256||reports[suite].models.find(m=>m.id===baseline).artifactSha256!==experiment.baseCheckpoint.gguf_sha256)throw Error('Report artifact differs from the pinned model');
      let expected=await json(path.join(out,evaluationPlan.suites[suite].filename));
      if(suite==='context'){
        const ids=new Set((await json(path.join(out,evaluationPlan.suites.regression.filename))).map(c=>c.id));
        expected=expected.filter(c=>!ids.has(c.id));
      }
      const actual=reports[suite].cases.map(({payload,payloadSha256,...c})=>c);
      if(canonicalJson(actual)!==canonicalJson(expected))throw Error('Report cases differ from the frozen suite');
      baselinePredictions.set(`${name}:${suite}`,[...points(reports[suite],baseline)].map(([id,r])=>[id,r.actualClass,r.status]));
    }
    if(missing){results.push({seed,arm,status:'pending'});continue;}
    const checks={};
    const metrics=Object.fromEntries(suites.map(suite=>[suite,{baseline:summarize(reports[suite],baseline),candidate:summarize(reports[suite],model),paired:paired(reports[suite],model)}]));
    const baselineJoint=joint(reports,baseline),candidateJoint=joint(reports,model);
    const wins=[...candidateJoint].filter(([id,pass])=>pass&&!baselineJoint.get(id)).map(([id])=>id);
    const losses=[...candidateJoint].filter(([id,pass])=>!pass&&baselineJoint.get(id)).map(([id])=>id);
    checks.freshJointTaskAccuracyImproved=wins.length>losses.length;
    checks.noClassAccuracyRegression=suites.every(s=>classes.every(c=>metrics[s].candidate.byClass[c].correct>=metrics[s].baseline.byClass[c].correct));
    checks.noSevereUnderRouteIncrease=suites.every(s=>metrics[s].candidate.severeUnderRoutes<=metrics[s].baseline.severeUnderRoutes);
    checks.noLegacyOrContextAggregateLoss=['regression','context'].every(s=>metrics[s].candidate.correct>=metrics[s].baseline.correct);
    checks.noFailedAttempts=suites.every(s=>metrics[s].candidate.failedAttempts===0&&metrics[s].baseline.failedAttempts===0);
    results.push({seed,arm,status:'screened',model,checks,passesAccuracyScreen:Object.values(checks).every(Boolean),jointFresh:{tasks:baselineJoint.size,baselineCorrect:[...baselineJoint.values()].filter(Boolean).length,candidateCorrect:[...candidateJoint.values()].filter(Boolean).length,wins,losses},metrics,reportDigests:Object.fromEntries(suites.map(s=>[s,reports[s].digest]))});
  }
}
const pairedSeeds=experiment.seeds.map(seed=>{
  const control=results.find(r=>r.seed===seed&&r.arm==='control'),learning=results.find(r=>r.seed===seed&&r.arm==='learning');
  if(control.status!=='screened'||learning.status!=='screened')return {seed,status:'pending'};
  const baselineConsistentBetweenPairs=suites.every(s=>canonicalJson(baselinePredictions.get(`control-${seed}:${s}`))===canonicalJson(baselinePredictions.get(`learning-${seed}:${s}`)));
  return {seed,status:'screened',baselineConsistentBetweenPairs,learningBeatsControl:learning.jointFresh.candidateCorrect>control.jointFresh.candidateCorrect,learningPassesAccuracyScreen:learning.passesAccuracyScreen,jointCorrectDifference:learning.jointFresh.candidateCorrect-control.jointFresh.candidateCorrect};
});
const complete=results.every(r=>r.status==='screened');
const summary={schema:'amos.router-boundary-experiment-results',version:1,generatedAt:new Date().toISOString(),screenComplete:complete,qualification:false,productionChanged:false,protocol,results,pairedSeeds,recipeSupported:complete&&pairedSeeds.every(p=>p.baselineConsistentBetweenPairs&&p.learningBeatsControl&&p.learningPassesAccuracyScreen),nextMeasurementCandidates:results.filter(r=>r.passesAccuracyScreen).map(r=>r.model),claimBoundary:'Synthetic policy-supervised development evaluation. Each fresh task has two correlated representations. Screen timing is exploratory; promotion requires independent qualification, repeated latency and actual memory evidence.'};
await writeFile(path.join(out,'results.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({screenComplete:complete,recipeSupported:summary.recipeSupported,rows:results.map(r=>({seed:r.seed,arm:r.arm,status:r.status,passesAccuracyScreen:r.passesAccuracyScreen,jointFresh:r.jointFresh&&{base:r.jointFresh.baselineCorrect,candidate:r.jointFresh.candidateCorrect,wins:r.jointFresh.wins.length,losses:r.jointFresh.losses.length},scores:r.metrics&&Object.fromEntries(suites.map(s=>[s,[r.metrics[s].baseline.correct,r.metrics[s].candidate.correct,r.metrics[s].baseline.cases]]))})),pairedSeeds},null,2));
