"""One-off feed probe: fetch every sports endpoint the site plans to use and save the raw
responses under data/sports/_probe/ so parsers can be built against real payloads."""
import json, pathlib, re, sys, time
import requests

OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "sports" / "_probe"
OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "Accept": "*/*"}
E = "https://site.api.espn.com/apis/site/v2/sports/"
URLS = {
 "nfl_scoreboard": E + "football/nfl/scoreboard",
 "nfl_scoreboard_wk5": E + "football/nfl/scoreboard?dates=20261011",
 "nfl_teams": E + "football/nfl/teams",
 "nfl_team_det": E + "football/nfl/teams/det",
 "nfl_team_det_schedule": E + "football/nfl/teams/det/schedule",
 "nfl_team_det_roster": E + "football/nfl/teams/det/roster",
 "nfl_team_det_injuries": E + "football/nfl/teams/det/injuries",
 "nfl_injuries": E + "football/nfl/injuries",
 "nfl_standings": "https://site.api.espn.com/apis/v2/sports/football/nfl/standings",
 "nfl_leaders_core": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/types/2/teams/8/leaders",
 "nfl_team_stats_web": "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/teams/8/statistics",
 "mlb_scoreboard": E + "baseball/mlb/scoreboard?dates=20261012",
 "mlb_teams": E + "baseball/mlb/teams",
 "mlb_team_det_schedule": E + "baseball/mlb/teams/det/schedule",
 "mlb_standings": "https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings",
 "nhl_scoreboard": E + "hockey/nhl/scoreboard?dates=20261013",
 "nhl_teams": E + "hockey/nhl/teams",
 "nhl_team_det_schedule": E + "hockey/nhl/teams/det/schedule",
 "nhl_injuries": E + "hockey/nhl/injuries",
 "nhl_standings": "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings",
 "nba_scoreboard": E + "basketball/nba/scoreboard",
 "nba_teams": E + "basketball/nba/teams",
 "nba_team_det_schedule": E + "basketball/nba/teams/det/schedule",
 "nba_standings": "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings",
 "ncaaf_scoreboard": E + "football/college-football/scoreboard?groups=80&dates=20261010",
 "ncaaf_teams": E + "football/college-football/teams?groups=80&limit=300",
 "ncaaf_team_msu_schedule": E + "football/college-football/teams/127/schedule",
 "ncaaf_team_msu": E + "football/college-football/teams/127",
 "ncaaf_standings": "https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80",
 "ncaab_teams": E + "basketball/mens-college-basketball/teams?groups=50&limit=500",
 "ncaab_team_msu_schedule": E + "basketball/mens-college-basketball/teams/127/schedule",
 "ncaab_scoreboard": E + "basketball/mens-college-basketball/scoreboard?groups=50",
 "ncaah_teams": E + "hockey/mens-college-hockey/teams?limit=200",
 "ncaah_scoreboard": E + "hockey/mens-college-hockey/scoreboard?dates=20261010",
 "ncaah_team_msu_schedule": E + "hockey/mens-college-hockey/teams/msu/schedule",
 "epl_scoreboard": E + "soccer/eng.1/scoreboard",
 "ucl_scoreboard": E + "soccer/uefa.champions/scoreboard",
 "mls_scoreboard": E + "soccer/usa.1/scoreboard",
 "golf_scoreboard": E + "golf/pga/scoreboard",
 "atp_scoreboard": E + "tennis/atp/scoreboard",
 "wta_scoreboard": E + "tennis/wta/scoreboard",
 "nhlapi_standings": "https://api-web.nhle.com/v1/standings/now",
 "nhlapi_score": "https://api-web.nhle.com/v1/score/2026-10-12",
 "mlbapi_standings": "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026",
 "mlbapi_hitting": "https://statsapi.mlb.com/api/v1/teams/stats?season=2026&sportId=1&group=hitting&stats=season",
 "nflverse_games": "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
}
def main():
    log = {}
    for name, url in URLS.items():
        t0 = time.time()
        try:
            r = requests.get(url, headers=UA, timeout=30)
            log[name] = {"url": url, "status": r.status_code, "bytes": len(r.content), "ms": int((time.time() - t0) * 1000),
                         "cors": r.headers.get("access-control-allow-origin"), "cache": r.headers.get("cache-control")}
            if url.endswith(".csv"):
                lines = r.text.splitlines()
                (OUT / f"{name}.csv").write_text("\n".join(lines[:1] + [l for l in lines if l.startswith("2026_")]))
            else:
                try:
                    (OUT / f"{name}.json").write_text(json.dumps(r.json(), indent=1)[:4_000_000])
                except Exception:
                    (OUT / f"{name}.txt").write_text(r.text[:20000])
        except Exception as e:
            log[name] = {"url": url, "error": str(e)}
        print(name, log[name].get("status"), log[name].get("bytes"), log[name].get("error", ""))
        time.sleep(0.3)
    (OUT / "_log.json").write_text(json.dumps(log, indent=1))

if __name__ == "__main__":
    main()
