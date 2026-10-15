"""Slow-changing ESPN data, saved as small JSON files the pages read directly:

  data/sports/teams.json             every team in every team league (ids, names, colours, logos, group)
  data/sports/standings/{lg}.json    division/conference tables, slimmed to what the pages show
  data/sports/injuries/{lg}.json     pro injury reports keyed by ESPN team id (status and body part only)
  data/sports/leaders/{lg}.json      pro team stat leaders, athlete names resolved

Live scores and game pages do not come from here; the Worker passes those through from ESPN.
ESPN's written injury notes and recaps are editorial text and are deliberately not copied."""
import re

from .common import ESPN, ESPN_V2, get, read, write
from .leagues import LEAGUES, PRO, TEAM_LEAGUES, path

CORE = "https://sports.core.api.espn.com/v2/sports/"


# ---------------------------------------------------------------- season info
def season_info(lg):
    """{year, type} of the league's current season according to its scoreboard."""
    L = LEAGUES[lg]
    params = {"groups": L["groups"]} if L.get("groups") else None
    d = get(ESPN + path(lg) + "/scoreboard", params)
    s = d["leagues"][0]["season"]
    return {"year": int(s["year"]), "type": int(s["type"]["type"]), "label": s.get("displayName"),
            "calendar": d["leagues"][0].get("calendar") or [], "calendarType": d["leagues"][0].get("calendarType")}


# ---------------------------------------------------------------- standings
def _num(v):
    try:
        return float(str(v).replace("+", "").replace("%", ""))
    except (TypeError, ValueError):
        return None


def _rec_pct(s):
    """'6-1-1, 13 PTS' / '4-0' -> win share (ties/OT losses count half)."""
    if not s:
        return None
    m = re.match(r"\s*(\d+)-(\d+)(?:-(\d+))?", s)
    if not m:
        return None
    w, l, t = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    n = w + l + t
    return (w + 0.5 * t) / n if n else None


def _leaves(node, parent=None):
    if node.get("standings", {}).get("entries"):
        yield node, parent
    for c in node.get("children", []) or []:
        yield from _leaves(c, node)


def _row(e, college=False):
    t = e["team"]
    st = {}
    by_type = {}
    for x in e.get("stats", []):
        st[x["name"]] = x
        if x.get("type"):
            by_type[x["type"]] = x
    def dv(name, typ=None):
        x = st.get(name) or (by_type.get(typ) if typ else None)
        return x.get("displayValue") if x else None
    def val(name):
        x = st.get(name)
        if not x:
            return None
        v = x.get("value")
        return v if v is not None else _num(x.get("displayValue"))
    overall = dv("overall", "total") or ""
    logo = (t.get("logos") or [{}])[0].get("href")
    r = {
        "id": t["id"], "abbr": t.get("abbreviation"), "name": t.get("displayName"), "short": t.get("shortDisplayName"),
        "logo": logo,
        "w": val("wins"), "l": val("losses"), "t": val("ties"), "otl": val("otLosses"),
        "gp": val("gamesPlayed"), "pts": val("points"),
        "pct": _num(dv("winPercent")), "gb": dv("gamesBehind"),
        "pf": val("pointsFor"), "pa": val("pointsAgainst"), "diff": dv("pointDifferential") or dv("differential"),
        "streak": dv("streak"), "seed": val("playoffSeed"), "clinch": dv("clincher"),
        "overall": overall.split(",")[0].strip() or None,
        "home": dv("Home", "home") or dv("home", "homerecord"),
        "road": dv("Road", "road") or dv("away", "awayrecord") or dv("Road", "awayrecord"),
        "conf": dv("vs. Conf.", "vsconf"), "div": dv("vs. Div.", "vsdiv"), "l10": dv("Last Ten Games", "lasttengames"),
    }
    # college splits come through with prefixed names; fall back to the stat type
    for k, typ in (("home", "homerecord"), ("road", "awayrecord"), ("conf", "vsconf")):
        if not r[k] and typ in by_type:
            r[k] = by_type[typ].get("displayValue")
    if college:
        # college "wins"/"pointsFor" stats are conference-only and inconsistent; use the record strings
        for k in ("w", "l", "t", "otl", "gp", "pf", "pa", "diff", "seed", "gb", "pct", "pts"):
            r.pop(k, None)
        m = re.match(r"\s*(\d+)-(\d+)(?:-(\d+))?", r.get("overall") or "")
        if m:
            r["w"], r["l"] = int(m.group(1)), int(m.group(2))
            if m.group(3):
                r["t"] = int(m.group(3))
            r["gp"] = r["w"] + r["l"] + (r.get("t") or 0)
    if r.get("gp") is None:
        r["gp"] = sum(int(x or 0) for x in (r["w"], r["l"], r["t"], r["otl"]))
    return {k: (int(v) if isinstance(v, float) and v.is_integer() and k not in ("pct",) else v) for k, v in r.items() if v not in (None, "")}


def _sort_key(lg, r):
    if lg == "nhl" and r.get("pts") is not None:
        return (-(r.get("pts") or 0), r.get("gp") or 0, -(r.get("w") or 0))
    if lg.startswith("ncaa"):
        return (-(_rec_pct(r.get("conf")) or 0), -(_rec_pct(r.get("overall")) or 0), -(r.get("w") or 0))
    return (-(r.get("pct") if r.get("pct") is not None else (_rec_pct(r.get("overall")) or 0)), -(r.get("w") or 0))


def standings(lg, season=None):
    L = LEAGUES[lg]
    params = {"seasontype": "2"}
    if lg in PRO:
        params["level"] = "3"           # divisions; ESPN returns conferences without it
    if L.get("groups"):
        params["group"] = L["groups"]
    if season:
        params["season"] = str(season)
    d = get(ESPN_V2 + path(lg) + "/standings", params)
    groups = []
    for node, parent in _leaves(d):
        rows = [_row(e, lg.startswith("ncaa")) for e in node["standings"]["entries"]]
        rows.sort(key=lambda r: _sort_key(lg, r))
        groups.append({"name": node.get("name"), "abbr": node.get("abbreviation"),
                       "parent": parent.get("name") if parent and parent is not d else None,
                       "teams": rows})
    if not groups:
        raise RuntimeError("no standings groups returned")
    return {"lg": lg, "season": (d.get("season") or {}).get("year") if isinstance(d.get("season"), dict) else d.get("season"),
            "groups": groups}


def job_standings():
    out = {}
    for lg in TEAM_LEAGUES:
        try:
            s = standings(lg)
            write(f"standings/{lg}.json", s)
            out[lg] = sum(len(g["teams"]) for g in s["groups"])
        except Exception as e:      # college hockey/basketball can be empty before the season starts
            out[lg] = f"error: {e}"[:160]
    if all(isinstance(v, str) for v in out.values()):
        raise RuntimeError(f"all standings failed: {out}")
    return out


# ---------------------------------------------------------------- teams index
def teams_index():
    """Every team in every team league. College lists are limited to the division the pages cover
    (FBS, D-I men's basketball) by intersecting with the league's standings groups."""
    out = {"leagues": {}}
    for lg in TEAM_LEAGUES:
        L = LEAGUES[lg]
        params = {"limit": "1000"}
        if L.get("groups"):
            params["groups"] = L["groups"]
        d = get(ESPN + path(lg) + "/teams", params)
        raw = [x["team"] for x in d["sports"][0]["leagues"][0]["teams"]]
        st = read(f"standings/{lg}.json") or {}
        member = {}
        for g in st.get("groups", []):
            for r in g["teams"]:
                member[r["id"]] = (g.get("name"), g.get("parent"))
        rows = []
        for t in raw:
            if not t.get("isActive", True):
                continue
            # FBS / D-I basketball: keep the standings members. ESPN's college hockey standings miss
            # some D-I programs, so hockey keeps the whole list and groups the rest as "Other".
            if lg in ("ncaaf", "ncaab") and member and t["id"] not in member:
                continue
            grp, parent = member.get(t["id"], ("Other" if lg == "ncaah" and member else None, None))
            logo = (t.get("logos") or [{}])[0].get("href")
            rows.append({k: v for k, v in {
                "id": t["id"], "abbr": t.get("abbreviation"), "name": t.get("displayName"), "short": t.get("shortDisplayName"),
                "loc": t.get("location"), "nick": t.get("name"), "color": t.get("color"), "alt": t.get("alternateColor"),
                "logo": logo, "group": grp, "parent": parent,
            }.items() if v})
        # standings members missing from the list (rare) still get a row so every table links somewhere
        have = {r["id"] for r in rows}
        for g in st.get("groups", []):
            for r in g["teams"]:
                if r["id"] not in have:
                    rows.append({"id": r["id"], "abbr": r.get("abbr"), "name": r.get("name"), "short": r.get("short"),
                                 "logo": r.get("logo"), "group": g.get("name"), "parent": g.get("parent")})
                    have.add(r["id"])
        rows.sort(key=lambda r: r.get("name") or "")
        out["leagues"][lg] = rows
    write("teams.json", out)
    return {lg: len(v) for lg, v in out["leagues"].items()}


# ---------------------------------------------------------------- injuries
def injuries(lg):
    d = get(ESPN + path(lg) + "/injuries", timeout=60)
    teams = {}
    for t in d.get("injuries", []):
        rows = []
        for i in t.get("injuries", []):
            if (i.get("status") or "").lower() == "active":     # cleared players stay in ESPN's list
                continue
            a = i.get("athlete") or {}
            det = i.get("details") or {}
            rows.append({k: v for k, v in {
                "name": a.get("displayName"), "pos": (a.get("position") or {}).get("abbreviation"),
                "status": i.get("status") or (i.get("type") or {}).get("description"),
                "part": det.get("type"), "side": det.get("side") if det.get("side") not in (None, "Not Specified") else None,
                "ret": det.get("returnDate"), "date": (i.get("date") or "")[:10] or None,
            }.items() if v})
        rank = {"Out": 0, "Injured Reserve": 0, "Doubtful": 1, "Questionable": 2, "Day-To-Day": 3}
        rows.sort(key=lambda r: (rank.get(r.get("status"), 4), r.get("name") or ""))
        teams[str(t.get("id"))] = rows
    return {"lg": lg, "teams": teams}


def job_injuries():
    out = {}
    for lg in PRO:
        try:
            r = injuries(lg)
            write(f"injuries/{lg}.json", r)
            out[lg] = sum(len(v) for v in r["teams"].values())
        except Exception as e:
            out[lg] = f"error: {e}"[:160]
    if all(isinstance(v, str) for v in out.values()):
        raise RuntimeError(f"all injury feeds failed: {out}")
    return out


# ---------------------------------------------------------------- leaders
PREFERRED = {
    "nfl": ["passingYards", "rushingYards", "receivingYards", "sacks", "interceptions", "totalTackles"],
    "nba": ["pointsPerGame", "reboundsPerGame", "assistsPerGame", "stealsPerGame", "blocksPerGame", "fieldGoalPercentage"],
    "nhl": ["goals", "assists", "points", "plusMinus", "savePct", "wins"],
    "mlb": ["avg", "homeRuns", "RBIs", "onBasePlusSlugging", "ERA", "strikeouts"],
}


def _https(u):
    return u.replace("http://", "https://", 1) if u else u


def _athlete(ref, cache):
    ref = _https(ref).split("?")[0]
    if ref not in cache:
        try:
            a = get(ref, {"lang": "en", "region": "us"})
            cache[ref] = {"id": a.get("id"), "name": a.get("displayName"), "short": a.get("shortName"),
                          "pos": (a.get("position") or {}).get("abbreviation"), "jersey": a.get("jersey")}
        except Exception:
            cache[ref] = None
    return cache[ref]


def _team_leaders(lg, year, typ, team_id, cache):
    L = LEAGUES[lg]
    u = f"{CORE}{L['sport']}/leagues/{L['slug']}/seasons/{year}/types/{typ}/teams/{team_id}/leaders"
    d = get(u, {"lang": "en", "region": "us"})
    cats = {c["name"]: c for c in d.get("categories", []) if c.get("leaders")}
    if not cats:
        return None
    names = [n for n in PREFERRED.get(lg, []) if n in cats] or list(cats)[:6]
    rows = []
    for n in names[:6]:
        c = cats[n]
        top = c["leaders"][0]
        a = _athlete((top.get("athlete") or {}).get("$ref"), cache) if top.get("athlete") else None
        if not a:
            continue
        rows.append({"cat": n, "label": c.get("displayName") or n, "abbr": c.get("abbreviation"),
                     "value": top.get("displayValue"), "athlete": a})
    return rows or None


def leaders(lg, team_ids):
    si = season_info(lg)
    year = si["year"]
    tries = [(year, 2)]
    if si["type"] == 3:                    # postseason: regular-season leaders still the right table
        tries = [(year, 2)]
    tries.append((year - 1, 2))             # preseason / no games yet -> last season, labelled as such
    cache, out, used = {}, {}, None
    probe = team_ids[0]
    for y, t in tries:
        try:
            if _team_leaders(lg, y, t, probe, cache):
                used = (y, t)
                break
        except Exception:
            continue
    if not used:
        raise RuntimeError("no leaders available")
    for tid in team_ids:
        try:
            rows = _team_leaders(lg, used[0], used[1], tid, cache)
        except Exception:
            rows = None
        if rows:
            out[tid] = rows
    return {"lg": lg, "season": used[0], "current": used[0] == year, "teams": out}


def job_leaders():
    idx = read("teams.json") or {}
    out = {}
    for lg in PRO:
        ids = [t["id"] for t in idx.get("leagues", {}).get(lg, [])]
        if not ids:
            out[lg] = "error: no teams index"
            continue
        try:
            r = leaders(lg, ids)
            write(f"leaders/{lg}.json", r)
            out[lg] = f"{len(r['teams'])} teams, season {r['season']}"
        except Exception as e:
            out[lg] = f"error: {e}"[:160]
    if all(str(v).startswith("error") for v in out.values()):
        raise RuntimeError(f"all leaders failed: {out}")
    return out
