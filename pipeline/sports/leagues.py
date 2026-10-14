"""League registry shared by every sports job (mirrors LEAGUES in assets/sports-data.js)."""

LEAGUES = {
    "nfl":   {"sport": "football",   "slug": "nfl",                     "label": "NFL"},
    "mlb":   {"sport": "baseball",   "slug": "mlb",                     "label": "MLB"},
    "nhl":   {"sport": "hockey",     "slug": "nhl",                     "label": "NHL"},
    "nba":   {"sport": "basketball", "slug": "nba",                     "label": "NBA"},
    "ncaaf": {"sport": "football",   "slug": "college-football",        "label": "College football", "groups": "80"},
    "ncaab": {"sport": "basketball", "slug": "mens-college-basketball", "label": "College basketball", "groups": "50"},
    "ncaah": {"sport": "hockey",     "slug": "mens-college-hockey",     "label": "College hockey"},
}
PRO = ["nfl", "mlb", "nhl", "nba"]
TEAM_LEAGUES = list(LEAGUES)


def path(lg):
    L = LEAGUES[lg]
    return f"{L['sport']}/{L['slug']}"
