"""Entry point:  python -m pipeline.run market|daily|quarterly|auto

'auto' picks jobs from the GitHub event: the schedule that fired, or everything
on a manual run / pipeline push. Writes data/finance/status.json either way.
"""
import os
import sys
import time

from . import jobs, own13f
from .net import STATUS, attempt, now_iso, read, write


def pick():
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    cron = os.environ.get("CRON", "")
    if os.environ.get("JOBS", "").strip():  # a manual run can name the jobs it wants: market daily screener quarterly
        return os.environ["JOBS"].split()
    if event == "schedule":
        if cron.startswith("17 11"):
            return ["daily", "screener", "notes", "fed"]
        if cron.startswith("23 9"):
            return ["quarterly"]
        return ["market", "fed"]
    want = ["market", "daily", "screener", "fed"]
    own = read("ownership/index.json") or {}
    if os.environ.get("RUN_13F") == "1" or own.get("v") != own13f.VERSION:
        want.append("quarterly")
    return want


def main():
    which = sys.argv[1:] or ["auto"]
    if which == ["plan"]:  # the workflow asks which jobs to run, then runs and commits each one
        print(" ".join(pick()))
        return
    if which == ["auto"]:
        which = pick()
    status = read("status.json", {}) or {}
    for job in which:
        STATUS.clear()
        t0 = time.time()
        attempt(f"job {job}", getattr(jobs, job))
        status[job] = {"finished": now_iso(), "seconds": round(time.time() - t0), "sources": dict(STATUS),
                       "failed": sorted(k for k, v in STATUS.items() if not v.get("ok"))}
        print(f"== {job}: {len(STATUS)} sources, {len(status[job]['failed'])} failed in {status[job]['seconds']}s")
        for k in status[job]["failed"]:
            print("   FAILED", k, STATUS[k].get("error"))
    status["updated"] = now_iso()
    write("status.json", status)


if __name__ == "__main__":
    main()
