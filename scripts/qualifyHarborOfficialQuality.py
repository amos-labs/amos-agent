#!/usr/bin/env python3
"""Write the official-quality gate separately from organism structure gates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from benchmarks.harbor_agents.harbor_official_quality import qualify_official_quality


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trial-result", action="append", default=[])
    parser.add_argument("--baseline-passed-tests", type=int, required=True)
    parser.add_argument("--minimum-seeds", type=int, default=1)
    parser.add_argument("--output")
    args = parser.parse_args()
    report = qualify_official_quality(
        [Path(path) for path in args.trial_result],
        baseline_passed_tests=args.baseline_passed_tests,
        minimum_seeds=args.minimum_seeds,
    )
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
