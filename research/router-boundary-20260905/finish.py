"""Finish the existing bounded experiment; never train again or select production models."""
from pathlib import Path
from datetime import datetime, timezone
import json, subprocess, sys, time, os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

root=Path(__file__).resolve().parents[2]
out=root/'output/router-boundary-20260905'
research=Path(__file__).resolve().parent
node=os.environ.get('AMOS_NODE_BINARY','node')
training=json.loads((out/'training-submission.json').read_text())['jobName']
if sys.argv[1:]!=['--execute']:
    print(json.dumps({'trainingJob':training,'actions':['Wait for existing training','Submit prepared one-hour CPU export once','Download and verify six experimental artifacts','Register experimental names and run local paired screens','Save terminal cloud receipts and summarize'],'productionChanges':False,'newTrainingJobs':0}));raise SystemExit(0)
config=Config(connect_timeout=5,read_timeout=10,retries={'total_max_attempts':1})
sm=boto3.client('sagemaker',region_name='us-east-1',config=config)
s3=boto3.client('s3',region_name='us-east-1',config=config)
started=time.monotonic()
def emit(event,**details):print(json.dumps({'event':event,'at':datetime.now(timezone.utc).isoformat(),**details}),flush=True)
def save(name,value):(out/name).write_text(json.dumps(value,indent=2,default=str)+'\n')
def run(args,log,timeout):
    with (out/log).open('a') as stream:subprocess.run(args,cwd=root,stdout=stream,stderr=subprocess.STDOUT,check=True,timeout=timeout)
def expired():
    if time.monotonic()-started>9000:raise RuntimeError('Local finishing workflow reached its 150-minute bound; inspect existing jobs')
previous=None
while True:
    expired()
    job=sm.describe_training_job(TrainingJobName=training);save('training-status.json',job)
    status=job['TrainingJobStatus']
    if status!=previous:emit('training-status',status=status);previous=status
    if status=='Completed':save('training-completed.json',job);break
    if status in ['Failed','Stopped']:raise RuntimeError('Training ended '+status+': '+job.get('FailureReason',''))
    time.sleep(30)
if not (out/'export-submission.json').exists():
    emit('export-submitting')
    run([sys.executable,str(research/'launch_export.py'),'--execute'],'export-submission.log',300)
submission=json.loads((out/'export-submission.json').read_text());export=submission['jobName']
cfg=json.loads((out/'export-source/export-config.json').read_text())
experiment=json.loads((out/'experiment.json').read_text())
names=[f'{arm}-{seed}' for seed in experiment['seeds'] for arm in (['control','learning'] if seed%2 else ['learning','control'])]
complete=set()
previous=None
while True:
    expired()
    job=sm.describe_processing_job(ProcessingJobName=export);save('export-status.json',job)
    status=job['ProcessingJobStatus']
    if status!=previous:emit('export-status',jobName=export,status=status);previous=status
    if status in ['Failed','Stopped']:raise RuntimeError('Export ended '+status+': '+job.get('FailureReason',''))
    if status=='Completed':save('export-completed.json',job)
    advanced=False
    for name in names:
        if name in complete:continue
        try:s3.head_object(Bucket=cfg['bucket'],Key=cfg['prefix']+'/'+name+'/manifest.json')
        except ClientError as error:
            if error.response['Error']['Code'] in ['404','NoSuchKey','NotFound']:continue
            raise
        if not (out/(name+'.registered.json')).exists():
            emit('artifact-registering',run=name)
            run([sys.executable,str(research/'fetch_register.py'),name],name+'.fetch.log',900)
        suites=['evaluation','evaluation-context','regression','context']
        reports=[out/(name+'.screen.'+suite+'.report.json') for suite in suites]
        if not all(p.exists() for p in reports):
            if any(p.exists() for p in reports) or (out/(name+'.screen.runtime-before.json')).exists():raise RuntimeError('Partial prior screen requires inspection: '+name)
            emit('local-screen-start',run=name)
            run([node,str(research/'evaluate.mjs'),name,'--screen'],name+'.screen.log',1800)
        run([node,str(research/'summarize.mjs')],'summary-history.log',60)
        complete.add(name);advanced=True;emit('local-screen-complete',run=name,completed=len(complete))
    if len(complete)==6 and status=='Completed':break
    if status=='Completed' and not advanced and len(complete)<6:raise RuntimeError('Completed exporter omitted an expected manifest')
    time.sleep(30)
summary=json.loads((out/'results.json').read_text())
emit('screening-complete',recipeSupported=summary['recipeSupported'],nextMeasurementCandidates=summary['nextMeasurementCandidates'])
save('finish-receipt.json',{'completedAt':datetime.now(timezone.utc).isoformat(),'trainingJob':training,'exportJob':export,'screensCompleted':sorted(complete),'productionChanged':False})
