"""Six independent continuations in one bounded GPU allocation."""
from pathlib import Path
import hashlib, json, os, shutil, subprocess, sys, time

source=Path(__file__).resolve().parent
plan=json.loads((source/'experiment.json').read_text())
output=Path(os.environ['SM_MODEL_DIR'])
initial=Path('/tmp/amos-initial-adapter')
if initial.exists():raise RuntimeError('Unexpected pre-existing adapter extraction directory')
completed=[]
for seed in plan['seeds']:
    # Alternate arm order across seeds, but every run reloads the unchanged parent.
    arms=['control','learning'] if seed%2 else ['learning','control']
    for arm in arms:
        name=f'{arm}-{seed}'
        destination=output/name
        destination.mkdir(exist_ok=False)
        env=dict(os.environ,SM_MODEL_DIR=str(destination),SM_CHANNEL_TRAIN=os.environ['SM_CHANNEL_'+arm.upper()],SM_CHECKPOINT_DIR='/opt/ml/checkpoints/'+name)
        dataset=Path(env['SM_CHANNEL_TRAIN'])/(arm+'.jsonl')
        if hashlib.sha256(dataset.read_bytes()).hexdigest()!=plan['datasets'][arm]['sha256']:raise RuntimeError('Dataset changed')
        cmd=[sys.executable,str(source/'train.py'),'--base-model',plan['baseCheckpoint']['base_model'],'--base-model-revision',plan['baseCheckpoint']['base_model_revision'],'--dataset-sha256',plan['datasets'][arm]['sha256'],'--initial-artifact-sha256',plan['baseCheckpoint']['source_artifact_sha256'],'--seed',str(seed),'--max-steps',str(plan['maxSteps']),'--learning-rate',str(plan['learningRate']),'--verified-repeats','1','--max-sequence-length','4096','--gradient-checkpointing','1','--epochs','1','--lora-rank','16','--lora-alpha','32','--batch-size','2','--gradient-accumulation','16']
        started=time.time()
        print('RUN_START',name,flush=True)
        subprocess.run(cmd,env=env,check=True,timeout=1500)
        completed.append(dict(name=name,elapsedSeconds=time.time()-started,metadata=json.loads((destination/'amos-router-adapter.json').read_text())))
        (output/'bundle-progress.json').write_text(json.dumps(completed,indent=2)+'\n')
        # Only this fresh job's extracted copy is removed; the input archive is immutable.
        shutil.rmtree(initial)
        print('RUN_COMPLETED',name,completed[-1]['elapsedSeconds'],flush=True)
print('BUNDLE_COMPLETED',len(completed),flush=True)
