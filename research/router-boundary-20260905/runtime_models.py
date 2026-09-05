"""Keep completed experiment runners from evicting the paired baseline."""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from contextlib import contextmanager

BASE_URL = 'http://127.0.0.1:11435'
EXPERIMENT_NAME = re.compile(r'amos-router:0\.8b-boundary-(control|learning)-2026090[567]')


@contextmanager
def awake_runtime():
    """Prevent macOS idle sleep for this measurement, without changing settings."""
    assertion = None
    if sys.platform == 'darwin':
        binary = shutil.which('caffeinate')
        if not binary:
            raise RuntimeError('macOS measurement requires caffeinate to prevent idle sleep')
        assertion = subprocess.Popen([binary, '-i', '-w', str(os.getpid())],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        yield
    finally:
        if assertion is not None and assertion.poll() is None:
            assertion.terminate()
            try:
                assertion.wait(timeout=5)
            except subprocess.TimeoutExpired:
                assertion.kill()
                assertion.wait()


def unload_other_experiments(keep=None):
    if keep is not None and not EXPERIMENT_NAME.fullmatch(keep):
        raise ValueError('Only a named experimental router can be retained')
    with urllib.request.urlopen(BASE_URL + '/api/ps', timeout=10) as response:
        resident = json.load(response)['models']
    unloaded = []
    for model in resident:
        name = model['name']
        if name == keep or not EXPERIMENT_NAME.fullmatch(name):
            continue
        request = urllib.request.Request(BASE_URL + '/api/generate',
            data=json.dumps({'model': name, 'keep_alive': 0, 'stream': False}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            json.load(response)
        unloaded.append(name)
    return unloaded
