from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil,sys,os

root=Path(__file__).resolve().parents[2];out=root/'output/router-boundary-20260905'
workspace=Path(os.environ.get('AMOS_WORKSPACE_ROOT', root.parents[1] if root.parent.name=='.worktrees' else root.parent))
platform=Path(os.environ.get('AMOS_PLATFORM_ROOT', workspace/'amos-managed-platform'))
program=json.loads((platform/'model_program/router/program-v1.json').read_text());aws=program['aws']
submission=json.loads((out/'training-submission.json').read_text());training_name=submission['jobName']
execute='--execute' in sys.argv
source=out/'export-source'
if not execute:
    source.mkdir(exist_ok=False)
    for name in ['export_ollama.py','requirements.txt','program-v1.json']:
        shutil.copy2(platform/'model_program/router'/name,source/name)
    shutil.copy2(Path(__file__).with_name('export_bundle.py'),source/'export_bundle.py')
    shutil.copy2(out/'experiment.json',source/'experiment.json')
    shutil.copy2(root/'src/model/intelligence-router-v1.txt',source/'prompt.txt')
    cfg=dict(bucket=aws['bucket'],prefix=aws['prefix']+'/experiments/router-boundary-20260905/exports',trainingJob=training_name,bundleKey=aws['prefix']+'/models/'+training_name+'/output/model.tar.gz',modelPrefix=aws['prefix']+'/models/'+training_name+'-split',referenceKey=aws['prefix']+'/experiments/learning-20260905/compact-exports/control/amos-router-q4_k_m.gguf',referenceSha256='3b9cf703f681567314495731ca0942af0da1f99bd10361b3ebf99927dd93543e')
    (source/'export-config.json').write_text(json.dumps(cfg,indent=2)+'\n')
    plan=dict(instanceType='ml.m5.xlarge',instanceCount=1,maximumRuntimeSeconds=3600,computePlanningCeilingUsd=3,sourceHashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()},note='Uses only cloud-resident training artifacts and a previously exported cloud reference. No local model bytes are uploaded.')
    (out/'export-plan.json').write_text(json.dumps(plan,indent=2)+'\n');print(json.dumps(plan));raise SystemExit(0)
plan=json.loads((out/'export-plan.json').read_text())
for name,digest in plan['sourceHashes'].items():assert hashlib.sha256((source/name).read_bytes()).hexdigest()==digest
if (out/'export-submission.json').exists():raise RuntimeError('An exporter was already submitted; inspect its status')
import boto3,sagemaker
from sagemaker.processing import ScriptProcessor,ProcessingInput
client=boto3.client('sagemaker',region_name=aws['region']);job=client.describe_training_job(TrainingJobName=training_name)
if job['TrainingJobStatus']!='Completed':raise RuntimeError('Training bundle must finish before conversion')
(out/'training-completed.json').write_text(json.dumps(job,indent=2,default=str)+'\n')
name='amos-router-boundary-export-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
with (out/'export-submission.json').open('x') as f:json.dump(dict(jobName=name,plan=plan),f,indent=2)
session=sagemaker.Session(boto_session=boto3.Session(region_name=aws['region']))
processor=ScriptProcessor(role=aws['role_arn'],image_uri='763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:2.6.0-cpu-py312',command=['python3'],instance_count=1,instance_type='ml.m5.xlarge',volume_size_in_gb=80,max_runtime_in_seconds=3600,sagemaker_session=session,env={'OMP_NUM_THREADS':'4','DEBIAN_FRONTEND':'noninteractive'},tags=[{'Key':'amos:program','Value':'router-v1'},{'Key':'amos:purpose','Value':'boundary-export'}])
processor.run(code=str(source/'export_bundle.py'),inputs=[ProcessingInput(source=str(source),destination='/opt/ml/processing/input/program')],job_name=name,wait=False,logs=False)
print(json.dumps(dict(jobName=name,computePlanningCeilingUsd=3)))
