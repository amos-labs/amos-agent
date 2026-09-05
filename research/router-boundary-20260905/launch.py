from pathlib import Path
import argparse, hashlib, json, shutil, sys, os
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/router-boundary-20260905'
workspace=Path(os.environ.get('AMOS_WORKSPACE_ROOT', ROOT.parents[1] if ROOT.parent.name=='.worktrees' else ROOT.parent))
PLATFORM=Path(os.environ.get('AMOS_PLATFORM_ROOT', workspace/'amos-managed-platform'))
sys.path.insert(0,str(PLATFORM))
from model_program.router.record_validation import read_training_records
from model_program.router.token_length_preflight import audit_token_lengths

args=argparse.ArgumentParser();args.add_argument('--execute',action='store_true');args=args.parse_args()
plan=json.loads((OUT/'experiment.json').read_text())
program=json.loads((PLATFORM/'model_program/router/program-v1.json').read_text());aws=program['aws']
from transformers import AutoTokenizer
tokenizer=AutoTokenizer.from_pretrained(str(PLATFORM/'model_program/router/artifacts/export-pilot003/merged-hf'),local_files_only=True)
preflights={}
for arm in ['control','learning']:
    rows,digest=read_training_records(OUT/(arm+'.jsonl'))
    assert digest==plan['datasets'][arm]['sha256']
    preflights[arm]=audit_token_lengths(rows,tokenizer,4096,'completion')
source=OUT/'training-source'
if not args.execute:
    source.mkdir(exist_ok=False)
    for name in ['train.py','completion_contract.py','ordinal_objective.py','record_validation.py','requirements.txt','learning_continuation.py']:
        shutil.copy2(PLATFORM/'model_program/router'/name,source/name)
    shutil.copy2(Path(__file__).with_name('train_bundle.py'),source/'train_bundle.py')
    shutil.copy2(OUT/'experiment.json',source/'experiment.json')
    manifest=dict(schema='amos.router-bounded-sweep',version=1,instanceType='ml.g5.xlarge',instanceCount=1,maximumRuntimeSeconds=7200,planningHourlyRateUsd=3,maximumComputeEstimateUsd=6,independentRuns=6,seeds=plan['seeds'],preflights=preflights,sourceHashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()},note='One bounded allocation runs six independent matched continuations; no production registration or promotion.')
    (OUT/'training-plan.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2));raise SystemExit(0)
manifest=json.loads((OUT/'training-plan.json').read_text())
assert manifest['preflights']==preflights
probe=json.loads((OUT/'baseline.training-probe.report.json').read_text())
assert probe['models'][0]['artifactSha256']==plan['baseCheckpoint']['gguf_sha256']
probe_tasks={c['id']:c['task'] for c in probe['cases']}
errors=len({probe_tasks[r['caseId']] for r in probe['runs'] if not r['correct']})
if errors<8:raise RuntimeError('Training probe has fewer than eight underlying tasks with observed mistakes; improve correction coverage before spending on a sweep')
for name,digest in manifest['sourceHashes'].items():assert hashlib.sha256((source/name).read_bytes()).hexdigest()==digest
assert (source/'experiment.json').read_bytes()==(OUT/'experiment.json').read_bytes()
if (OUT/'training-submission.json').exists():raise RuntimeError('Submission already recorded; inspect its status instead of relaunching')
import boto3,sagemaker
from sagemaker.pytorch import PyTorch
name='amos-router-boundary-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
session=sagemaker.Session(boto_session=boto3.Session(region_name=aws['region']))
channels={'initial':plan['baseCheckpoint']['source_artifact_uri']}
for arm in ['control','learning']:
    channels[arm]=session.upload_data(path=str(OUT/(arm+'.jsonl')),bucket=aws['bucket'],key_prefix=aws['prefix']+'/datasets/'+plan['datasets'][arm]['sha256'][:12])
with (OUT/'training-submission.json').open('x') as f:json.dump(dict(jobName=name,channels=channels,plan=manifest),f,indent=2)
estimator=PyTorch(entry_point='train_bundle.py',source_dir=str(source),role=aws['role_arn'],instance_count=1,instance_type='ml.g5.xlarge',framework_version='2.6.0',py_version='py312',code_location=f"s3://{aws['bucket']}/{aws['prefix']}/code",output_path=f"s3://{aws['bucket']}/{aws['prefix']}/models",max_run=7200,use_spot_instances=False,disable_profiler=True,debugger_hook_config=False,volume_size=80,tags=[{'Key':'amos:program','Value':'router-v1'},{'Key':'amos:purpose','Value':'balanced-policy-continuation'}],sagemaker_session=session)
estimator.fit(channels,job_name=name,wait=False,logs=False)
print(json.dumps(dict(jobName=name,maximumComputeEstimateUsd=6,independentRuns=6)),flush=True)
