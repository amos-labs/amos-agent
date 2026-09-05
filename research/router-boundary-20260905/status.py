from pathlib import Path
import json
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

out=Path(__file__).resolve().parents[2]/'output/router-boundary-20260905'
config=Config(connect_timeout=5,read_timeout=10,retries={'total_max_attempts':1})
sagemaker=boto3.client('sagemaker',region_name='us-east-1',config=config)
logs=boto3.client('logs',region_name='us-east-1',config=config)
for kind in ['training','export']:
    source=out/(kind+'-submission.json')
    if not source.exists():continue
    name=json.loads(source.read_text())['jobName']
    if kind=='training':
        job=sagemaker.describe_training_job(TrainingJobName=name)
        summary={k:job.get(k) for k in ['TrainingJobStatus','SecondaryStatus','TrainingTimeInSeconds','BillableTimeInSeconds','FailureReason']}
        group='/aws/sagemaker/TrainingJobs'
    else:
        job=sagemaker.describe_processing_job(ProcessingJobName=name)
        summary={k:job.get(k) for k in ['ProcessingJobStatus','ProcessingStartTime','ProcessingEndTime','FailureReason']}
        group='/aws/sagemaker/ProcessingJobs'
    (out/(kind+'-status.json')).write_text(json.dumps(job,indent=2,default=str)+'\n')
    print(json.dumps(dict(kind=kind,jobName=name,status=summary),default=str),flush=True)
    progress=[]
    try:
        streams=logs.describe_log_streams(logGroupName=group,logStreamNamePrefix=name,limit=5)['logStreams']
        for stream in streams:
            events=logs.get_log_events(logGroupName=group,logStreamName=stream['logStreamName'],limit=1000,startFromHead=False)['events']
            progress.extend(e for e in events if any(term in e['message'] for term in ['RUN_START','RUN_COMPLETED','BUNDLE_COMPLETED','EXPORT_READY','Traceback','Error:','train_loss','train_runtime']))
    except ClientError as error:
        print(json.dumps(dict(kind=kind,logReadError=error.response['Error']['Code'])),flush=True)
    except BotoCoreError as error:
        print(json.dumps(dict(kind=kind,logReadError=type(error).__name__)),flush=True)
    (out/(kind+'-progress.json')).write_text(json.dumps(progress,indent=2)+'\n')
    print(json.dumps(dict(kind=kind,jobName=name,status=summary,progress=progress[-16:]),default=str),flush=True)
