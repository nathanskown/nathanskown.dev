"""Entry point:  python -m pipeline.sports.run live|daily|plan

  live   standings, injuries, house model (hourly)
  daily  teams index and team stat leaders, then everything in live

Each source reports into data/sports/status.json; a failed source never blocks the others."""
import os
import sys
import time

from . import cbbret, ctx, espn, nflsnap, evolution, extra, history, lab, model, nflqb, odds, track, tune
from .common import STATUS, attempt, now_iso, read, write

JOBS = {
    "live": [("standings", espn.job_standings), ("injuries", espn.job_injuries), ("model", model.job_model),
             ("qb", nflqb.job_qb), ("track", track.job_track)],
    "daily": [("standings", espn.job_standings), ("teams", espn.teams_index), ("leaders", espn.job_leaders),
              ("injuries", espn.job_injuries), ("mlb_sp", extra.job_mlb_current), ("nhl_xg", extra.job_nhl_current), ("box", ctx.job_collect_current), ("nfl_snaps", nflsnap.job_snaps), ("ctx_fit", ctx.job_fit), ("rosters", cbbret.job_rosters), ("odds", odds.job_odds), ("model", model.job_model), ("qb", nflqb.job_qb), ("track", track.job_track),
              ("backtest", track.job_backtest)],
    # one-off, started by hand from the "Sports history and tuning" workflow
    "history": [("history", history.job_history), ("nflqb", nflqb.job_history), ("nfl_snaps", nflsnap.job_snaps)],
    "extra": [("extra", extra.job_extra)],
    "lab-probe": [("probe", lab.job_probe)],
    "lab-collect": [("collect", lab.job_collect)],
    "lab-cfbd": [("cfbd", lab.job_cfbd)],
    "lab-probe2": [("probe2", lab.job_probe2)],
    "ctx-fit": [("ctx_fit", ctx.job_fit), ("ret_fit", cbbret.job_fit), ("model", model.job_model), ("track", track.job_track)],
    "tune": [("tune", tune.job_tune), ("evolution", evolution.job_evolution), ("qb_fit", nflqb.job_fit), ("ctx_fit", ctx.job_fit), ("ret_fit", cbbret.job_fit), ("model", model.job_model), ("qb", nflqb.job_qb), ("track", track.job_track), ("backtest", track.job_backtest)],
}


def pick():
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    cron = os.environ.get("CRON", "")
    if event == "schedule" and not cron.startswith("41 10"):
        # the teams index must exist before anything else is useful; build it on the first run
        return ["daily"] if read("teams.json") is None else ["live"]
    return ["daily"]


def main():
    which = sys.argv[1:] or ["plan"]
    if which == ["plan"]:
        print(" ".join(pick()))
        return
    status = read("status.json", {}) or {}
    for job in which:
        STATUS.clear()
        t0 = time.time()
        results = {}
        for name, fn in JOBS[job]:
            results[name] = attempt(name, fn)
            if STATUS[name]["ok"]:
                STATUS[name]["result"] = results[name]
        status[job] = {"finished": now_iso(), "seconds": round(time.time() - t0), "sources": dict(STATUS),
                       "failed": sorted(k for k, v in STATUS.items() if not v.get("ok"))}
        print(f"== {job}: {len(STATUS)} sources, {len(status[job]['failed'])} failed in {status[job]['seconds']}s")
        for k, v in STATUS.items():
            print("  ", "ok " if v.get("ok") else "FAILED", k, v.get("result") or v.get("error"))
    status["updated"] = now_iso()
    write("status.json", status)


if __name__ == "__main__":
    main()
