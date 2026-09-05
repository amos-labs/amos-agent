import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'output/router-boundary-20260905');
const workspace=process.env.AMOS_WORKSPACE_ROOT || (path.basename(path.dirname(root))==='.worktrees'?path.resolve(root,'../..'):path.dirname(root));
const platform=process.env.AMOS_PLATFORM_ROOT || path.join(workspace,'amos-managed-platform');
const hash=x=>createHash('sha256').update(x).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const experiment=await json(path.join(out,'experiment.json'));
const mode=process.argv[2];
const screen=process.argv[3]==='--screen';
if(process.argv[3]&&!screen)throw Error('Unknown evaluation option');
const runName=mode+(screen?'.screen':'');
const baseUrl='http://127.0.0.1:11435';
const sourceFiles=['src/model/intelligenceRouter.js','src/model/intelligence-router-v1.txt','src/model/intelligence-router-artifact-v1.json','src/model/signedText.js','src/research/routerLearningEvaluation.js','src/util/canonicalJson.js'];
if(mode==='prepare') {
  const snapshot=path.join(out,'evaluation-source');
  await mkdir(snapshot,{recursive:true});
  await save(path.join(snapshot,'package.json'),{type:'module'});
  const sourceHashes={};
  for(const file of sourceFiles){await mkdir(path.dirname(path.join(snapshot,file)),{recursive:true});await cp(path.join(root,file),path.join(snapshot,file));sourceHashes[file]=hash(await readFile(path.join(snapshot,file)));}
  const {intelligenceRouterPayload}=await import(pathToFileURL(path.join(snapshot,'src/model/intelligenceRouter.js')));
  const legacy=await json(path.join(platform,'model_program/router/artifacts/learning-20260905/regression.cases.json'));
  const contextSource=await json(process.env.AMOS_ROUTER_CONTEXT_CASES || path.join(workspace,'amos-agent/output/router-context-20260905-request-last/cases.json'));
  const context=contextSource.map(c=>{
    if(intelligenceRouterPayload(c)!==c.candidatePayload)throw Error('Context-fixed baseline differs from prior measured wrapper');
    const messages=c.messages.filter(m=>['user','assistant'].includes(m.role)).map(({role,content})=>({role,content}));
    if(intelligenceRouterPayload({messages})!==c.candidatePayload)throw Error('Removing ignored tool messages changed the router input');
    return {id:c.id,family:c.family,task:messages.findLast(m=>m.role==='user').content,messages,expectedClass:c.expectedClass};
  });
  const specs={evaluation:await json(path.join(out,'evaluation.cases.json')),'evaluation-context':await json(path.join(out,'evaluation-context.cases.json')),regression:legacy,context,'training-probe':await json(path.join(out,'training-probe.cases.json'))};
  const suites={};
  for(const [name,cases] of Object.entries(specs)){
    const filename=`frozen-${name}.json`;
    await save(path.join(out,filename),cases);
    suites[name]={filename,sha256:hash(await readFile(path.join(out,filename))),cases:cases.length,repetitions:name==='training-probe'?1:3};
  }
  await save(path.join(out,'evaluation-plan.json'),{sourceHashes,suites,sourceExperimentSha256:hash(await readFile(path.join(out,'experiment.json'))),warmOnly:true,qualification:false,baseline:'amos-router:0.8b-pilot003-v2',note:'Fresh synthetic policy tasks; legacy/context sets are already observed diagnostics. Context variants are correlated, not independent task counts.'});
  console.log(JSON.stringify({suites,sourceFiles:sourceFiles.length}));
} else {
  const plan=await json(path.join(out,'evaluation-plan.json'));
  const protocol=await json(path.join(out,'screen-protocol.json'));
  if(hash(await readFile(fileURLToPath(import.meta.url)))!==protocol.evaluationDriverSha256)throw Error('Evaluation driver differs from the frozen protocol');
  if(hash(await readFile(path.join(out,'experiment.json')))!==plan.sourceExperimentSha256)throw Error('Experiment changed');
  const snapshot=path.join(out,'evaluation-source');
  for(const [file,digest] of Object.entries(plan.sourceHashes))if(hash(await readFile(path.join(snapshot,file)))!==digest)throw Error('Frozen evaluator changed');
  const {LocalIntelligenceRouter}=await import(pathToFileURL(path.join(snapshot,'src/model/intelligenceRouter.js')));
  const {runRouterLearningEvaluation,validateRouterLearningReport}=await import(pathToFileURL(path.join(snapshot,'src/research/routerLearningEvaluation.js')));
  const get=async route=>{const r=await fetch(baseUrl+route,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const tags=(await get('/api/tags')).models;
  const defs=[{id:plan.baseline,artifactSha256:experiment.baseCheckpoint.gguf_sha256,artifactBytes:529296768}];
  const baseline=path.join(os.homedir(),'Library/Application Support/@amos-labs/amos-agent/local-intelligence/ollama/models/blobs/sha256-'+defs[0].artifactSha256);
  if(hash(await readFile(baseline))!==defs[0].artifactSha256)throw Error('Baseline GGUF changed');
  if(mode!=='baseline'){
    if(!/^(control|learning)-2026090[567]$/.test(mode))throw Error('Select baseline or an experiment arm/seed');
    const folder=path.join(out,'exports',mode),m=await json(path.join(folder,'manifest.json'));
    const bytes=await readFile(path.join(folder,m.gguf));
    if(hash(bytes)!==m.gguf_sha256)throw Error('Candidate GGUF changed');
    const installed=path.join(os.homedir(),'Library/Application Support/@amos-labs/amos-agent/local-intelligence/ollama/models/blobs/sha256-'+m.gguf_sha256);
    if(hash(await readFile(installed))!==m.gguf_sha256)throw Error('Installed candidate GGUF differs from export');
    defs.push({id:`amos-router:0.8b-boundary-${mode}`,artifactSha256:m.gguf_sha256,artifactBytes:bytes.length});
  }
  for(const m of defs){const tag=tags.find(t=>t.name===m.id);if(!tag)throw Error('Model not registered: '+m.id);m.runtimeDigest=tag.digest;}
  const environment={hardwareId:`${os.cpus()[0].model}; ${os.cpus().length} cores; ${os.totalmem()} bytes; ${os.platform()} ${os.arch()}`,runtimeVersion:(await get('/api/version')).version,quantization:'Q4_K_M',mode:'warm'};
  for(const m of defs)await new LocalIntelligenceRouter({model:m.id,baseUrl,timeoutMs:30000}).classify({messages:[{role:'user',content:'Hello.'}]});
  const ps=await get('/api/ps');
  for(const m of defs)if(!ps.models.some(p=>p.name===m.id&&p.context_length===4096))throw Error('Paired models are not both warm and resident');
  await save(path.join(out,`${runName}.runtime-before.json`),{environment,models:defs,ps});
  const transport=[];
  const fetchImpl=async(url,options)=>{
    const r=await fetch(url,options);
    if(url.endsWith('/api/chat')&&r.ok){const p=await r.clone().json();transport.push({model:p.model,loadDurationNs:p.load_duration,totalDurationNs:p.total_duration,promptTokens:p.prompt_eval_count,outputTokens:p.eval_count});}
    return r;
  };
  const suites=mode==='baseline'?['training-probe']:screen?['evaluation','evaluation-context','regression','context']:['evaluation','evaluation-context','regression','context','training-probe'];
  for(const name of suites){
    const suite=plan.suites[name],body=await readFile(path.join(out,suite.filename));
    if(hash(body)!==suite.sha256)throw Error('Frozen cases changed');
    let cases=JSON.parse(body);
    if(name==='context'){
      // Legacy regression cases also occur in the saved context experiment.
      // Measure them once per pass and do not inflate independent task counts.
      const regressionIds=new Set((await json(path.join(out,plan.suites.regression.filename))).map(c=>c.id));
      cases=cases.filter(c=>!regressionIds.has(c.id));
    }
    const report=await runRouterLearningEvaluation({cases,models:defs,environment,repetitions:screen?1:suite.repetitions,timeoutMs:3000,baseUrl,partition:'development',frozenCases:true,fetchImpl});
    validateRouterLearningReport(report);
    await save(path.join(out,`${runName}.${name}.report.json`),report);
    console.log(JSON.stringify({arm:mode,suite:name,models:Object.fromEntries(Object.entries(report.metrics.byModel).map(([k,v])=>[k,{accuracy:v.accuracy,underRouteRate:v.underRouteRate,severeUnderRouteRate:v.severeUnderRouteRate,latencyMs:v.latencyMs}]))}),);
  }
  await save(path.join(out,`${runName}.runtime-after.json`),{ps:await get('/api/ps'),transport});
}
