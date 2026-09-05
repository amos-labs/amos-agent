"""Convert cloud-trained artifacts and publish lossless patches against a cloud reference."""
from pathlib import Path
import gzip, hashlib, json, shutil, subprocess, sys, tarfile
import boto3
import numpy as np

program=Path('/opt/ml/processing/input/program')
work=Path('/opt/ml/processing/work');work.mkdir(parents=True,exist_ok=True)
cfg=json.loads((program/'export-config.json').read_text())
experiment=json.loads((program/'experiment.json').read_text())
s3=boto3.client('s3',region_name='us-east-1')
def run(args): subprocess.run(args,check=True)
def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def publish(p,key):s3.upload_file(str(p),cfg['bucket'],cfg['prefix']+'/'+key)

run(['apt-get','update','-qq'])
run(['apt-get','install','-y','-qq','git','cmake','build-essential'])
run([sys.executable,'-m','pip','install','-r',str(program/'requirements.txt')])
llama=work/'llama.cpp'
run(['git','init',str(llama)])
run(['git','-C',str(llama),'remote','add','origin','https://github.com/ggml-org/llama.cpp.git'])
run(['git','-C',str(llama),'fetch','--depth','1','origin','936918514ce522b553c0fd80b169a6440e6096c6'])
run(['git','-C',str(llama),'checkout','--detach','FETCH_HEAD'])
run(['cmake','-S',str(llama),'-B',str(llama/'build'),'-DGGML_CUDA=OFF','-DGGML_BLAS=OFF','-DLLAMA_CURL=OFF','-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_SERVER=OFF'])
run(['cmake','--build',str(llama/'build'),'--target','llama-quantize','-j','4'])
sys.path.insert(0,str(program))
from export_ollama import safe_extract
archive=work/'bundle.tar.gz'
s3.download_file(cfg['bucket'],cfg['bundleKey'],str(archive))
bundle_sha=sha(archive)
extracted=work/'bundle';safe_extract(archive,extracted)
progress=json.loads((extracted/'bundle-progress.json').read_text())
expected={f'{a}-{s}' for a in ['control','learning'] for s in experiment['seeds']}
assert {r['name'] for r in progress}==expected and len(progress)==6
reference=work/'reference.gguf'
s3.download_file(cfg['bucket'],cfg['referenceKey'],str(reference))
assert sha(reference)==cfg['referenceSha256']
for item in progress:
    name=item['name'];arm,seed=name.split('-');metadata=item['metadata']
    assert metadata['dataset_sha256']==experiment['datasets'][arm]['sha256']
    assert metadata['initial_artifact_sha256']==experiment['baseCheckpoint']['source_artifact_sha256']
    assert metadata['seed']==int(seed) and metadata['max_steps']==experiment['maxSteps']
    # Publish a conventional per-run artifact so the existing exporter remains unchanged.
    split=work/(name+'.tar.gz')
    with tarfile.open(split,'w:gz') as t:
        for p in (extracted/name).iterdir():t.add(p,arcname=p.name)
    model_key=cfg['modelPrefix']+'/'+name+'/output/model.tar.gz'
    s3.upload_file(str(split),cfg['bucket'],model_key)
    uri='s3://'+cfg['bucket']+'/'+model_key
    destination=work/('export-'+name)
    run([sys.executable,str(program/'export_ollama.py'),uri,'--plan',str(program/'program-v1.json'),'--llama-cpp-dir',str(llama),'--output-dir',str(destination),'--router-prompt',str(program/'prompt.txt'),'--execute'])
    manifest=json.loads((destination/'manifest.json').read_text())
    gguf=destination/manifest['gguf'];patch=destination/'model.byte-diff.gz'
    with reference.open('rb') as base,gguf.open('rb') as target,patch.open('wb') as output,gzip.GzipFile(fileobj=output,mode='wb',compresslevel=6,mtime=0) as compressed:
        for chunk in iter(lambda:target.read(1024*1024),b''):
            ref=base.read(len(chunk)).ljust(len(chunk),b'\0')
            compressed.write(np.subtract(np.frombuffer(chunk,dtype=np.uint8),np.frombuffer(ref,dtype=np.uint8),dtype=np.uint8).tobytes())
    h=hashlib.sha256();count=0
    with reference.open('rb') as base,gzip.open(patch,'rb') as stream:
        for delta in iter(lambda:stream.read(1024*1024),b''):
            ref=base.read(len(delta)).ljust(len(delta),b'\0')
            data=np.add(np.frombuffer(ref,dtype=np.uint8),np.frombuffer(delta,dtype=np.uint8),dtype=np.uint8).tobytes()
            h.update(data);count+=len(data)
    assert h.hexdigest()==manifest['gguf_sha256'] and count==gguf.stat().st_size
    manifest['transfer']=dict(format='uint8-difference-gzip',referenceSha256=cfg['referenceSha256'],patch=patch.name,patchSha256=sha(patch),patchBytes=patch.stat().st_size,ggufBytes=count)
    manifest['bundleProvenance']=dict(jobName=cfg['trainingJob'],bundleSha256=bundle_sha,runName=name,trainingMetadata=metadata)
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    publish(patch,name+'/'+patch.name);publish(gguf,name+'/'+gguf.name);publish(destination/'manifest.json',name+'/manifest.json')
    print('EXPORT_READY',name,manifest['gguf_sha256'],patch.stat().st_size,flush=True)
    # These are derived scratch copies inside this fresh processing job.
    shutil.rmtree(destination);split.unlink()
print('EXPORT_BUNDLE_COMPLETED',flush=True)
