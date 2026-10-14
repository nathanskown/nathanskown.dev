"""Exit 0 if every staged data change is only a timestamp (so the commit, and the redeploy it triggers, can be skipped).

Used by the data workflows: python tools/only_timestamps.py && echo skip
"""
import json
import subprocess
import sys

NOISE = {"updated", "generated", "asOf", "finished", "seconds", "at", "fetched"}


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in NOISE}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


def main():
    files = subprocess.run(["git", "diff", "--cached", "--name-only"], capture_output=True, text=True).stdout.split()
    if not files:
        return 0
    for f in files:
        if not f.endswith(".json"):
            return 1
        old = subprocess.run(["git", "show", f"HEAD:{f}"], capture_output=True, text=True)
        if old.returncode != 0:  # new file
            return 1
        try:
            new = json.load(open(f))
            if strip(json.loads(old.stdout)) != strip(new):
                return 1
        except (OSError, ValueError):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
