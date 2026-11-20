"""MLB pitch-level summaries from the MLB Stats API game feed (statsapi.mlb.com), individual non-commercial use.

For every finished regular-season game this keeps two compact things, not the raw pitches:
  st: each starting pitcher's start: workload (batters faced, pitches, outs, strikeouts, walks) and, per pitch type and
      batter side, usage, average speed, spin, induced vertical and horizontal break, extension, and the counts behind
      CSW (called strikes + whiffs), whiff, zone, chase and put-away rates.
  pa: every plate appearance as [batter, pitcher, batter side, pitcher hand, outcome code], so hitter strikeout rates by
      pitcher hand can be built for matchups.

Writes history/mlb_pitch_{year}.json. Started by hand (lab mode "mlbpitch"), then kept current by the daily run.
"""
import os
import time
from datetime import date, timedelta

from .common import get, now_iso, read, write

API = "https://statsapi.mlb.com/api/"
YEARS = [2025, 2026]
WHIFF = {"S", "W", "T", "M"}               # swinging strike, blocked, foul tip, missed bunt
CALLED = {"C"}
SWING = WHIFF | {"F", "L", "O", "X", "D", "E"}
OUTCOME = {"strikeout": "K", "strikeout_double_play": "K", "strikeout_triple_play": "K", "walk": "BB", "intent_walk": "BB",
           "hit_by_pitch": "HBP", "single": "1B", "double": "2B", "triple": "3B", "home_run": "HR"}


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _game_pks(year):
    """Finished regular-season games with their dates."""
    d = get(API + "v1/schedule", {"sportId": "1", "gameType": "R", "season": str(year)})
    out = {}
    for day in d.get("dates", []):
        for g in day.get("games", []):
            if (g.get("status") or {}).get("codedGameState") == "F":
                out[str(g["gamePk"])] = day.get("date")
    return out


def summarize(feed):
    gd, ld = feed.get("gameData") or {}, feed.get("liveData") or {}
    box = (ld.get("boxscore") or {}).get("teams") or {}
    teams = {s: ((gd.get("teams") or {}).get(s) or {}).get("abbreviation") for s in ("home", "away")}
    starters = {}
    for side in ("home", "away"):
        ps = (box.get(side) or {}).get("pitchers") or []
        if ps:
            starters[ps[0]] = side
    st = {pid: {"pid": pid, "team": teams[side], "opp": teams["away" if side == "home" else "home"], "hand": None, "bf": 0, "np": 0,
                "k": 0, "bb": 0, "outs": 0, "types": {}} for pid, side in starters.items()}
    pa = []
    for play in (ld.get("plays") or {}).get("allPlays", []):
        m = play.get("matchup") or {}
        pid = (m.get("pitcher") or {}).get("id")
        bid = (m.get("batter") or {}).get("id")
        bside, phand = (m.get("batSide") or {}).get("code"), (m.get("pitchHand") or {}).get("code")
        ev = (play.get("result") or {}).get("eventType") or ""
        if (play.get("result") or {}).get("type") != "atBat":
            continue
        pa.append([bid, pid, bside, phand, OUTCOME.get(ev, "O")])
        s = st.get(pid)
        if not s:
            continue
        s["hand"] = phand
        s["bf"] += 1
        s["k"] += OUTCOME.get(ev) == "K"
        s["bb"] += OUTCOME.get(ev) == "BB"
        strikes = 0
        pitches = [e for e in play.get("playEvents") or [] if e.get("isPitch")]
        for i, e in enumerate(pitches):
            det, pd = e.get("details") or {}, e.get("pitchData") or {}
            code = ((det.get("type") or {}).get("code")) or "UN"
            call = ((det.get("call") or {}).get("code")) or ""
            key = f"{code}|{bside}"
            t = s["types"].setdefault(key, {"n": 0, "v": 0.0, "vn": 0, "spin": 0.0, "sn": 0, "ivb": 0.0, "hb": 0.0, "bn": 0, "ext": 0.0, "en": 0,
                                            "csw": 0, "wh": 0, "sw": 0, "z": 0, "oz": 0, "ch": 0, "two": 0, "pa": 0})
            t["n"] += 1; s["np"] += 1
            v = _f(pd.get("startSpeed"))
            if v:
                t["v"] += v; t["vn"] += 1
            br = pd.get("breaks") or {}
            sp = _f(br.get("spinRate"))
            if sp:
                t["spin"] += sp; t["sn"] += 1
            ivb, hb = _f(br.get("breakVerticalInduced")), _f(br.get("breakHorizontal"))
            if ivb is not None and hb is not None:
                t["ivb"] += ivb; t["hb"] += hb; t["bn"] += 1
            ex = _f(pd.get("extension"))
            if ex:
                t["ext"] += ex; t["en"] += 1
            zone = pd.get("zone")
            inzone = isinstance(zone, int) and 1 <= zone <= 9
            if isinstance(zone, int):
                t["z"] += inzone
                if not inzone:
                    t["oz"] += 1
                    t["ch"] += call in SWING
            t["csw"] += call in WHIFF or call in CALLED
            t["wh"] += call in WHIFF
            t["sw"] += call in SWING
            if strikes == 2:
                t["two"] += 1
                t["pa"] += (i == len(pitches) - 1 and OUTCOME.get(ev) == "K")
            if call in CALLED or call in WHIFF or (call in {"F", "L"} and strikes < 2):
                strikes = min(2, strikes + 1)
    for pid, side in starters.items():
        ip = (((box.get(side) or {}).get("players") or {}).get(f"ID{pid}") or {}).get("stats", {}).get("pitching", {})
        st[pid]["outs"] = int(ip.get("outs") or 0)
        for t in st[pid]["types"].values():
            for a, b in (("v", "vn"), ("spin", "sn"), ("ext", "en")):
                t[a] = round(t[a] / t[b], 1) if t[b] else None
            t["ivb"] = round(t["ivb"] / t["bn"], 1) if t["bn"] else None
            t["hb"] = round(t["hb"] / t["bn"], 1) if t["bn"] else None
            for k in ("vn", "sn", "en", "bn"):
                t.pop(k)
    return list(st.values()), pa


def collect(year, budget_s=None):
    rel = f"history/mlb_pitch_{year}.json"
    store = read(rel) or {"year": year, "source": "MLB Stats API (statsapi.mlb.com) game feed", "g": {}}
    t0 = time.time()
    pks = _game_pks(year)
    todo = [pk for pk in pks if pk not in store["g"]]
    print(f"mlb {year}: {len(pks)} finished games, {len(todo)} to fetch", flush=True)
    done = fail = 0
    for pk in todo:
        if budget_s and time.time() - t0 > budget_s:
            break
        try:
            feed = get(API + f"v1.1/game/{pk}/feed/live", timeout=60)
            st, pa = summarize(feed)
            store["g"][pk] = {"d": pks[pk], "st": st, "pa": pa}
            done += 1
        except Exception as e:
            fail += 1
            if fail < 5:
                print(f"  {pk}: {str(e)[:120]}", flush=True)
        if done and done % 300 == 0:
            store["updated"] = now_iso()
            write(rel, store)
    store["updated"] = now_iso()
    write(rel, store)
    return {"games": len(store["g"]), "fetched": done, "failed": fail, "seconds": round(time.time() - t0)}


def job_backfill():
    years = [int(y) for y in os.environ.get("MLB_YEARS", "").split(",") if y] or YEARS
    return {y: collect(y, budget_s=int(os.environ.get("LAB_BUDGET", "9000"))) for y in years}


def job_current():
    """Daily: the current season's new games (spring training excluded; nothing to do in the offseason)."""
    t = date.today()
    year = t.year if t.month >= 3 else t.year - 1
    if not (3 <= t.month <= 10) and read(f"history/mlb_pitch_{year}.json"):
        return {"skipped": "offseason"}
    return collect(year, budget_s=600)
