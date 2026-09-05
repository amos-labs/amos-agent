"""Repeat passing screens with sampled Ollama runner-tree RSS; never promote."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess
import sys
import time
from runtime_models import awake_runtime, unload_other_experiments

root = Path(__file__).resolve().parents[2]
out = root / 'output/router-boundary-20260905'


def read(path):
    return json.loads(path.read_text())


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def sample(models):
    # Only matching Ollama process metadata is retained. Other process arguments
    # are never read. RSS is a sampled OS counter, not total unified-memory use.
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss=,comm='], text=True, timeout=10)
    processes = {}
    roots = {model: [] for model in models}
    for line in raw.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) != 4:
            continue
        pid, parent, rss = map(int, fields[:3])
        processes[pid] = {'parent': parent, 'rssBytes': rss * 1024, 'command': fields[3]}
    for pid, process in processes.items():
        if '/ollama/' not in process['command']:
            continue
        try:
            args = subprocess.check_output(['ps', '-p', str(pid), '-o', 'args='], text=True, timeout=5)
        except subprocess.CalledProcessError:
            continue  # Process exited between snapshots.
        for model, digest in models.items():
            if '--model ' in args and 'sha256-' + digest in args:
                roots[model].append(pid)
    measurements = {}
    for model, pids in roots.items():
        if len(pids) != 1:
            continue
        descendants = set(pids)
        while True:
            expanded = descendants | {pid for pid, p in processes.items() if p['parent'] in descendants}
            if expanded == descendants:
                break
            descendants = expanded
        measurements[model] = {
            'runnerPid': pids[0], 'processIds': sorted(descendants),
            'rssBytes': sum(processes[pid]['rssBytes'] for pid in descendants),
        }
    return measurements


def main():
    results = read(out / 'results.json')
    names = [row['model'].removeprefix('amos-router:0.8b-boundary-')
             for row in results['results'] if row.get('passesAccuracyScreen')]
    if sys.argv[1:] != ['--execute']:
        print(json.dumps({'candidates': names, 'actions': ['Wait until all six screens are complete',
              'Repeat the frozen evaluator sequentially for passing candidates',
              'Measure actual matched Ollama runner process trees every two seconds'],
              'newCloudJobs': 0, 'productionChanged': False}))
        return
    if not results['screenComplete'] or not (out / 'finish-receipt.json').exists():
        raise RuntimeError('Complete the existing finisher before starting repeated inference')
    baseline = 'amos-router:0.8b-pilot003-v2'
    experiment = read(out / 'experiment.json')
    for name in names:
        prefix = out / (name + '.memory')
        summary_path = Path(str(prefix) + '.json')
        if summary_path.exists():
            previous = read(summary_path)
            if previous['evaluationExitCode'] != 0 or not previous['completePairedSamples']:
                raise RuntimeError('Inspect failed previous measurement: ' + name)
            continue
        if (out / (name + '.runtime-before.json')).exists() or Path(str(prefix) + '.jsonl').exists():
            raise RuntimeError('Inspect partial previous measurement: ' + name)
        candidate = 'amos-router:0.8b-boundary-' + name
        print(json.dumps({'event': 'experimental-runners-unloaded',
                          'models': unload_other_experiments(candidate)}), flush=True)
        models = {baseline: experiment['baseCheckpoint']['gguf_sha256'],
                  candidate: read(out / 'exports' / name / 'manifest.json')['gguf_sha256']}
        sample(models)  # Verify process visibility before any inference starts.
        print(json.dumps({'event': 'repeated-evaluation-start', 'run': name}), flush=True)
        started = time.monotonic()
        collected = []
        with (out / (name + '.full.log')).open('x') as log, Path(str(prefix) + '.jsonl').open('x') as stream:
            process = subprocess.Popen([os.environ.get('AMOS_NODE_BINARY', 'node'),
                                        str(Path(__file__).with_name('evaluate.mjs')), name],
                                       cwd=root, stdout=log, stderr=subprocess.STDOUT)
            try:
                while process.poll() is None:
                    if time.monotonic() - started > 1800:
                        raise RuntimeError('Repeated evaluation exceeded its 30-minute bound')
                    measurements = sample(models)
                    if (out / (name + '.runtime-before.json')).exists() and len(measurements) == len(models):
                        entry = {'at': datetime.now(timezone.utc).isoformat(), 'models': measurements}
                        stream.write(json.dumps(entry) + '\n')
                        stream.flush()
                        collected.append(entry)
                    time.sleep(2)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
        evidence = Path(str(prefix) + '.jsonl').read_bytes()
        summary = {
            'schema': 'amos.router-runtime-memory-measurement', 'version': 1,
            'source': 'external-runtime-process-tree-rss',
            'evidenceSha256': hashlib.sha256(evidence).hexdigest(),
            'samplingIntervalSeconds': 2, 'completePairedSamples': len(collected),
            'evaluationExitCode': process.returncode, 'productionChanged': False,
            'qualification': False,
            'limitations': 'Sampled runner-tree RSS excludes the shared Ollama daemon. Shared pages may be counted more than once; this is not total Metal/unified-memory accounting. The maximum is the largest observed sample, not a continuous peak.',
            'measurements': [{'modelId': model, 'artifactSha256': digest,
                              'peakRssBytes': max((r['models'][model]['rssBytes'] for r in collected), default=0)}
                             for model, digest in models.items()],
        }
        save(summary_path, summary)
        if process.returncode or not collected:
            raise RuntimeError('Repeated evaluation or memory measurement failed: ' + name)
        print(json.dumps({'event': 'repeated-evaluation-complete', 'run': name,
                          'samples': len(collected), 'memory': summary['measurements']}), flush=True)


if __name__ == '__main__':
    if sys.argv[1:] == ['--execute']:
        with awake_runtime():
            main()
    else:
        main()
