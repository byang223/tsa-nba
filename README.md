# NBA Over/Under Challenge tracker

- `index.html` — the site (static, reads the two JSON files)
- `league.json` — lines + every manager's picks (edit this to fix a typo)
- `standings.json` — written by the bot: W-L per team and the date each line was first settled
- `scripts/update-standings.mjs` — fetches ESPN standings and rewrites `standings.json`
- `.github/workflows/update-standings.yml` — runs the script every 3 hours and commits changes

## Setup
1. Push this folder to a GitHub repo.
2. Settings → Pages → deploy from the `main` branch, root.
3. Actions tab → "Update standings" → Run workflow (first run), then it runs on its own.

Local test: `ESPN_FIXTURE=fixture.json node scripts/update-standings.mjs`
