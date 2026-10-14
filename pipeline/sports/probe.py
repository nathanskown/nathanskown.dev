"""One-off feed probe: fetch every sports endpoint the site plans to use and save the raw
responses under data/sports/_probe/ so parsers can be built against real payloads."""
import json, pathlib, re, sys, time
import requests

OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "sports" / "_probe2"
OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "Accept": "*/*"}
E = "https://site.api.espn.com/apis/site/v2/sports/"
URLS = {
 "sum_nfl_final": E + "football/nfl/summary?event=401872991",
 "sum_nfl_pre": E + "football/nfl/summary?event=401873020",
 "sum_mlb_final": E + "baseball/mlb/summary?event=401908023",
 "sum_nhl_final": E + "hockey/nhl/summary?event=401892488",
 "sum_ncaaf_final": E + "football/college-football/summary?event=401858480",
 "sum_nba_pre": E + "basketball/nba/summary?event=401898404",
 "sum_ncaah_final": E + "hockey/mens-college-hockey/summary?event=401904840",
 "sum_epl_pre": E + "soccer/eng.1/summary?event=401878771",
 "nfl_scoreboard_range": E + "football/nfl/scoreboard?dates=20261015-20261020",
 "ncaaf_scoreboard_week": E + "football/college-football/scoreboard?groups=80&week=8&limit=200",
 "mlb_team_det_schedule_2026": E + "baseball/mlb/teams/det/schedule?season=2026&seasontype=2",
 "mlb_team_tb_schedule_post": E + "baseball/mlb/teams/tb/schedule?season=2026&seasontype=3",
 "ncaab_team_msu_schedule_2027": E + "basketball/mens-college-basketball/teams/127/schedule?season=2027",
 "nhl_team_det": E + "hockey/nhl/teams/det",
 "nba_team_det": E + "basketball/nba/teams/det",
 "ncaah_team_msu": E + "hockey/mens-college-hockey/teams/msu",
 "nfl_team_det_injuries2": E + "football/nfl/teams/8/injuries",
 "nba_injuries": E + "basketball/nba/injuries",
 "mlb_injuries": E + "baseball/mlb/injuries",
 "golf_leaderboard_live": "https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga",
 "nfl_team_det_leaders_core": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/types/2/teams/8/leaders",
 "nfl_teams_stats_site": E + "football/nfl/teams/8/statistics",
 "nhl_team_det_stats_site": E + "hockey/nhl/teams/det/statistics",
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
                    (OUT / f"{name}.json").write_text(json.dumps(r.json(), indent=1))
                except Exception:
                    (OUT / f"{name}.txt").write_text(r.text[:20000])
        except Exception as e:
            log[name] = {"url": url, "error": str(e)}
        print(name, log[name].get("status"), log[name].get("bytes"), log[name].get("error", ""))
        time.sleep(0.3)
    (OUT / "_log.json").write_text(json.dumps(log, indent=1))

if __name__ == "__main__":
    main()
