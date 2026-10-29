# CLAUDE.md

Tracker site for a private NBA Over/Under win-total league (2026-27 season, 11 managers).
Static site on GitHub Pages + a GitHub Action that refreshes standings. No backend, no build
step, no dependencies.

## Files

| File | What it is |
|---|---|
| `index.html` | The entire site: HTML, CSS and JS in one file. Reads `league.json` and `standings.json` at load. |
| `league.json` | Hand-edited source of truth: every team's line and every manager's picks and nugget count. |
| `standings.json` | Bot-written. `{ asOf, teams: {ABBR: [W, L]}, decided: {ABBR: "YYYY-MM-DD"} }`. Don't hand-edit except to reset. |
| `scripts/update-standings.mjs` | Node 18+ script, no deps. Fetches ESPN standings and rewrites `standings.json`. |
| `.github/workflows/update-standings.yml` | Runs the script every 3h (`15 */3 * * *` UTC), plus manual dispatch, and commits if anything changed. |

## League rules (as the code implements them)

- Each manager has 5 picks of over/under on a team's win line. **Order in `picks` matters:** the first
  two are Phase 1 (exclusive, **2 pts**), the last three are Phase 2 (shared, **1 pt**).
- A pick is **locked** (hit) once it's mathematically clinched: over → `W > line`; under → `82 - L < line`.
  It's **dead** when the reverse is clinched. Lines are all `.5`, so there are no pushes.
- Four bonus categories, +1 each, and ties all get the point:
  - **Apex Over:** the over pick (among all managers' overs) furthest ahead of its line on pace.
  - **Abyss Under:** the under pick furthest under its line on pace.
  - **First to Clinch:** manager(s) whose pick locked on the earliest `decided` date.
  - **First Eliminated:** manager(s) whose pick died on the earliest `decided` date.
- **Locked pts** = clinched picks + First-to-Clinch/First-Eliminated bonuses (which are permanent once set).
- **Projected pts** = picks ahead of pace + all four bonuses. The leaderboard sorts by projected.
- **Tiebreaker / Net wins** = sum over picks of signed pace differential (`proj - line` for overs, `line - proj` for unders), where `proj = W/G * 82`.
- **Bottom three** on the leaderboard (shaded) owe their `nuggets` count (McNugget punishment).

## How the pieces fit

- `index.html` has a **duplicate, embedded copy** of the lines (`T`) and picks (`M`) as a fallback
  for when it's opened without the JSON files. `league.json` overrides it on load. If you change
  lines or picks, edit `league.json` **and** keep the embedded `T`/`M` in sync, or you'll get
  confusing behavior opening the file locally.
- `decided[team]` records the **first day a team's line was settled** (either direction) and is
  never overwritten. The site uses it for the First-to-Clinch/Eliminated bonuses. Dates are an
  NBA "game day": anything detected before 4pm ET counts as the previous day.
- `?demo` in the URL shows a slider that simulates 0–82 games with deterministic fake standings
  (in demo mode `decided` values are game numbers, not dates). 0 = back to live data.
- JSON is fetched with `cache: "no-store"` so Pages caching doesn't hide fresh standings.

## Standings script

- ESPN unofficial endpoint: `site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2027&seasontype=2`.
  ESPN's season is the **ending year** (2026-27 → `2027`). Override with `SEASON` / `SEASON_TYPE` env vars.
- `ALIAS` maps ESPN abbreviations to ours (`GS→GSW`, `NY→NYK`, `SA→SAS`, `NO→NOP`, `UTAH→UTA`, `WSH→WAS`).
  Team keys in `league.json` must use the mapped (3-letter) form.
- `collect()` walks the payload for `{team, stats}` nodes and skips any subtree tagged with a
  different season type. That's the preseason fix; preseason records leaked in before.
- Safety checks that make it refuse to write (exit nonzero, so the Action fails visibly):
  any `league.json` team missing from ESPN, any team with more than 82 games, or total games
  going *down* vs. the previous `standings.json`. If ESPN has no regular-season data yet, it
  exits 0 without touching anything.
- Offline test: `ESPN_FIXTURE=fixture.json node scripts/update-standings.mjs` (run from repo root;
  the script reads/writes relative paths).

## Common tasks

- **Fix a pick or line typo:** edit `league.json` (and the embedded copy in `index.html`).
- **Reset standings** (e.g. bad data got committed): set `standings.json` back to
  `{"asOf":"","teams":{},"decided":{}}`. This also clears `decided`, so the clinch bonuses are
  recomputed from the next run's date. The games-went-down check compares against the file, so
  resetting is also how you get past it.
- **Force a refresh:** Actions tab → "Update standings" → Run workflow.
- **Preview locally:** serve the folder (e.g. `npx serve .` or `python -m http.server`). Opening
  `index.html` as a file won't load the JSON, so it falls back to the embedded data with 0-0 records.

## Conventions

- Keep it dependency-free and single-file. No framework, bundler, or `package.json`.
- `index.html` JS is deliberately terse/minified-style. Match the existing style for small edits.
- Theming uses CSS variables on `:root` with light/dark via `prefers-color-scheme` and `data-theme`.
- The bot commits only `standings.json` as `standings-bot`. Pull before pushing, because the Action
  commits to `main` every few hours.
