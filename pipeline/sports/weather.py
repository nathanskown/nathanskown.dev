"""Kickoff weather for upcoming outdoor NFL games (Open-Meteo forecasts, free, no key).

The NFL game totals (nflprops.py) take points off for wind above 10 mph in outdoor and open-roof stadiums. Finished
games carry the measured wind in nfldata's games.csv, but upcoming ones have none until after kickoff, so the live
totals never saw wind. This fills the gap with the forecast wind at the kickoff hour.

Each stadium is placed once from ESPN's venue city (game summary) and Open-Meteo's geocoder, and kept in
history/nfl_venues.json. Forecasts are refreshed every few hours for games in the next 7 days and written to
model/weather_nfl.json: {"games": {ESPN event id: {"wind": mph, "temp": F, "precip": mm, "at": kickoff hour UTC}}}."""
from datetime import datetime, timedelta, timezone

from .common import ESPN, get, now_iso, read, write

GEO = "https://geocoding-api.open-meteo.com/v1/search"
FC = "https://api.open-meteo.com/v1/forecast"
REFRESH_H = 3
STATES = {"AL": "Alabama", "AZ": "Arizona", "CA": "California", "CO": "Colorado", "FL": "Florida", "GA": "Georgia",
          "IL": "Illinois", "IN": "Indiana", "LA": "Louisiana", "MA": "Massachusetts", "MD": "Maryland", "MI": "Michigan",
          "MN": "Minnesota", "MO": "Missouri", "NC": "North Carolina", "NJ": "New Jersey", "NV": "Nevada", "NY": "New York",
          "OH": "Ohio", "PA": "Pennsylvania", "TN": "Tennessee", "TX": "Texas", "WA": "Washington", "WI": "Wisconsin",
          "DC": "District of Columbia", "VA": "Virginia", "KY": "Kentucky", "UT": "Utah", "OR": "Oregon"}
COUNTRY = {"USA": "US", "United States": "US", "England": "GB", "United Kingdom": "GB", "Germany": "DE", "Mexico": "MX",
           "Brazil": "BR", "Spain": "ES", "Ireland": "IE", "France": "FR", "Australia": "AU", "Canada": "CA"}


def _place(addr):
    """(lat, lon) for an ESPN venue address via the geocoder, or None."""
    city = (addr or {}).get("city")
    if not city:
        return None
    cc = COUNTRY.get((addr or {}).get("country") or "USA", None)
    st = STATES.get((addr or {}).get("state") or "", (addr or {}).get("state"))
    res = (get(GEO, {"name": city, "count": 10, "language": "en", "format": "json"}) or {}).get("results") or []
    ok = [r for r in res if (not cc or r.get("country_code") == cc) and (not st or cc != "US" or r.get("admin1") == st)]
    if not ok:
        return None
    best = max(ok, key=lambda r: r.get("population") or 0)
    return round(best["latitude"], 3), round(best["longitude"], 3)


def job_nfl():
    from . import nflqb
    from .leagues import path
    rows = [r for r in nflqb._csv(nflqb.GAMES_URL) if r["home_score"] in ("", None) and r.get("espn")]
    now = datetime.now(timezone.utc)
    venues = read("history/nfl_venues.json") or {"stadiums": {}}
    out = read("model/weather_nfl.json") or {"games": {}}
    games = {k: v for k, v in (out.get("games") or {}).items() if v.get("at", "") >= (now - timedelta(days=1)).strftime("%Y-%m-%dT%H")}
    cache = (read("model/_games_nfl.json") or {}).get("events", {})
    fetched = placed = skipped = 0
    for r in rows:
        ev = cache.get(r["espn"]) or {}
        if not ev.get("d"):
            continue
        kick = datetime.fromisoformat(ev["d"][:16]).replace(tzinfo=timezone.utc)
        if not (now - timedelta(hours=3) <= kick <= now + timedelta(days=7)):
            continue
        if r.get("roof") not in ("outdoors", "open"):
            skipped += 1                    # domes, closed roofs, and retractable roofs not yet listed as open
            continue
        old = games.get(r["espn"])
        if old and old.get("fetched", "") >= (now - timedelta(hours=REFRESH_H)).isoformat():
            continue
        sid = r.get("stadium_id") or r["home_team"]
        v = venues["stadiums"].get(sid)
        if not v:
            try:
                summ = get(ESPN + path("nfl") + "/summary", {"event": r["espn"]})
                addr = ((summ.get("gameInfo") or {}).get("venue") or {}).get("address")
                ll = _place(addr)
            except Exception:
                ll = None
            if not ll:
                continue
            v = venues["stadiums"][sid] = {"name": r.get("stadium"), "lat": ll[0], "lon": ll[1]}
            placed += 1
        try:
            fc = get(FC, {"latitude": v["lat"], "longitude": v["lon"], "hourly": "wind_speed_10m,temperature_2m,precipitation",
                          "wind_speed_unit": "mph", "temperature_unit": "fahrenheit", "timezone": "UTC", "forecast_days": 8})
        except Exception:
            continue
        h = fc.get("hourly") or {}
        at = kick.strftime("%Y-%m-%dT%H:00")
        if at not in (h.get("time") or []):
            continue
        i = h["time"].index(at)
        games[r["espn"]] = {"wind": round(h["wind_speed_10m"][i]), "temp": round(h["temperature_2m"][i]),
                            "precip": h["precipitation"][i], "at": at, "fetched": now_iso()}
        fetched += 1
    write("history/nfl_venues.json", venues)
    write("model/weather_nfl.json", {"games": games, "updated": now_iso(), "source": "Open-Meteo forecast at kickoff"})
    return {"forecasts": fetched, "stadiumsPlaced": placed, "indoorSkipped": skipped, "games": len(games)}


def nfl_wind():
    """{ESPN event id: forecast wind mph} for upcoming games."""
    return {k: v["wind"] for k, v in ((read("model/weather_nfl.json") or {}).get("games") or {}).items() if v.get("wind") is not None}
