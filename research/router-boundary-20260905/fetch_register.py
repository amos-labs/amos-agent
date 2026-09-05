"""Download a verified derived artifact; register only a new experimental name."""
from pathlib import Path
import gzip,hashlib,json,os,re,subprocess,sys,urllib.request
import boto3,numpy as np
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

root=Path(__file__).resolve().parents[2];out=root/'output/router-boundary-20260905'
name=sys.argv[1]
if not re.fullmatch(r'(control|learning)-2026090[567]',name):raise ValueError('Choose an experiment arm/seed')
experiment=json.loads((out/'experiment.json').read_text())
cfg=json.loads((out/'export-source/export-config.json').read_text())
client=boto3.client('s3',region_name='us-east-1',config=Config(max_pool_connections=16))
prefix=cfg['prefix']+'/'+name+'/'
manifest=json.loads(client.get_object(Bucket=cfg['bucket'],Key=prefix+'manifest.json')['Body'].read())
arm,seed=name.split('-');metadata=manifest['bundleProvenance']['trainingMetadata']
assert manifest['bundleProvenance']['jobName']==cfg['trainingJob'] and manifest['bundleProvenance']['runName']==name
assert manifest['source_artifact_uri']=='s3://'+cfg['bucket']+'/'+cfg['modelPrefix']+'/'+name+'/output/model.tar.gz'
assert metadata['dataset_sha256']==experiment['datasets'][arm]['sha256'] and manifest['dataset_sha256']==metadata['dataset_sha256']
assert metadata['seed']==int(seed) and metadata['initial_artifact_sha256']==experiment['baseCheckpoint']['source_artifact_sha256']
assert metadata['max_steps']==experiment['maxSteps'] and metadata['learning_rate']==experiment['learningRate']
assert manifest['quantization']=='Q4_K_M' and manifest['gguf']=='amos-router-q4_k_m.gguf'
transfer=manifest['transfer']
assert transfer['format']=='uint8-difference-gzip' and transfer['patch']=='model.byte-diff.gz'
assert transfer['referenceSha256']==cfg['referenceSha256']
assert 0<transfer['ggufBytes']<=600*2**20 and 0<transfer['patchBytes']<=600*2**20
def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
workspace=Path(os.environ.get('AMOS_WORKSPACE_ROOT', root.parents[1] if root.parent.name=='.worktrees' else root.parent))
platform=Path(os.environ.get('AMOS_PLATFORM_ROOT', workspace/'amos-managed-platform'))
reference=platform/'model_program/router/artifacts/learning-20260905/export-control/amos-router-q4_k_m.gguf'
assert sha(reference)==transfer['referenceSha256']
dest=out/'exports'/name;dest.mkdir(parents=True,exist_ok=False)
patch=dest/transfer['patch']
client.download_file(cfg['bucket'],prefix+patch.name,str(patch),Config=TransferConfig(max_concurrency=16,multipart_chunksize=1024*1024))
assert patch.stat().st_size==transfer['patchBytes'] and sha(patch)==transfer['patchSha256']
count=0
with reference.open('rb') as base,gzip.open(patch,'rb') as stream,(dest/manifest['gguf']).open('xb') as target:
    for delta in iter(lambda:stream.read(1024*1024),b''):
        count+=len(delta)
        if count>transfer['ggufBytes']:raise RuntimeError('Oversized reconstructed model')
        ref=base.read(len(delta)).ljust(len(delta),b'\0')
        target.write(np.add(np.frombuffer(ref,dtype=np.uint8),np.frombuffer(delta,dtype=np.uint8),dtype=np.uint8).tobytes())
assert count==transfer['ggufBytes'] and sha(dest/manifest['gguf'])==manifest['gguf_sha256']
prompt=(root/'src/model/intelligence-router-v1.txt').read_text().strip()
assert hashlib.sha256((prompt+'\n').encode()).hexdigest()==manifest['router_prompt_sha256']
(dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(dest/'Modelfile').write_text('FROM ./'+manifest['gguf']+'\nPARAMETER temperature 0\nPARAMETER num_ctx 4096\nSYSTEM """\n'+prompt+'\n"""\n')
model='amos-router:0.8b-boundary-'+name;base='http://127.0.0.1:11435'
with urllib.request.urlopen(base+'/api/tags') as r:tags=json.load(r)['models']
if any(t['name']==model for t in tags):raise RuntimeError('Experimental name already exists; do not overwrite')
env=dict(os.environ,OLLAMA_HOST=base)
binary=os.environ.get('AMOS_OLLAMA_BINARY',str(workspace/'amos-agent/desktop/vendor/ollama/ollama'))
with (out/(name+'.registration.log')).open('x') as log:subprocess.run([binary,'create',model,'-f',str(dest/'Modelfile')],env=env,check=True,stdout=log,stderr=subprocess.STDOUT)
with urllib.request.urlopen(base+'/api/tags') as r:tags=json.load(r)['models']
tag=next(t for t in tags if t['name']==model)
(out/(name+'.registered.json')).write_text(json.dumps(tag,indent=2)+'\n')
print(json.dumps(dict(model=model,ggufSha256=manifest['gguf_sha256'],runtimeDigest=tag['digest'],patchBytes=transfer['patchBytes'])),flush=True)
