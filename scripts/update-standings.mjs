// Updates standings.json from ESPN's unofficial NBA standings endpoint.
// Node 18+, no dependencies. Run from the repo root: node scripts/update-standings.mjs
// Test offline:  ESPN_FIXTURE=fixture.json node scripts/update-standings.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SEASON = process.env.SEASON || "2027"; // ESPN uses the ending year: 2026-27 -> 2027
const SEASON_TYPE = process.env.SEASON_TYPE || "2"; // 1 = preseason, 2 = regular season, 3 = postseason
const URL = `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${SEASON}&seasontype=${SEASON_TYPE}`;
const ALIAS = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };

const league = JSON.parse(readFileSync("league.json", "utf8"));
const prev = existsSync("standings.json")
  ? JSON.parse(readFileSync("standings.json", "utf8"))
  : {};
const prevTeams = prev.teams || {};
const decided = { ...(prev.decided || {}) };

// NBA "game day" label: games end by ~2am ET, so anything detected before 4pm ET
// belongs to the previous calendar day; evening changes belong to today.
function gameDay() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  if (+p.hour < 16) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// If a payload node declares a season type, return it as a number (else null).
function typeOf(n) {
  const v = n.seasonType ?? n.seasontype ?? n.season?.type;
  if (v == null) return null;
  const num = Number(typeof v === "object" ? v.type ?? v.id : v);
  return Number.isFinite(num) ? num : null;
}

// Find every { team, stats } entry anywhere in the payload, skipping any subtree
// that declares a season type other than the one we want (regular season).
function collect(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => collect(n, out));
  else if (node && typeof node === "object") {
    const t = typeOf(node);
    if (t !== null && t !== Number(SEASON_TYPE)) return out;
    if (node.team && Array.isArray(node.stats)) out.push(node);
    for (const v of Object.values(node)) if (v && typeof v === "object") collect(v, out);
  }
  return out;
}

const data = process.env.ESPN_FIXTURE
  ? JSON.parse(readFileSync(process.env.ESPN_FIXTURE, "utf8"))
  : await fetch(URL, { headers: { Accept: "application/json" } }).then((r) => {
      if (!r.ok) throw new Error(`ESPN responded ${r.status}`);
      return r.json();
    });

const entries = collect(data);
if (!entries.length) {
  console.log(`No season-type ${SEASON_TYPE} standings yet — leaving standings.json unchanged.`);
  process.exit(0);
}
const teams = {};
for (const e of entries) {
  const raw = e.team.abbreviation;
  const ab = ALIAS[raw] || raw;
  if (!league.teams[ab]) continue;
  const stat = (n) => {
    const s = e.stats.find((x) => x.name === n || x.type === n);
    return s ? Number(s.value ?? s.displayValue) || 0 : 0;
  };
  teams[ab] = [stat("wins"), stat("losses")];
}

const missing = Object.keys(league.teams).filter((t) => !teams[t]);
if (missing.length) throw new Error(`No standings found for: ${missing.join(", ")}`);

const games = (o) => Object.values(o).reduce((a, [w, l]) => a + w + l, 0);
for (const [t, [w, l]] of Object.entries(teams))
  if (w + l > 82) throw new Error(`${t} shows ${w + l} games — refusing to write`);
if (games(teams) < games(prevTeams))
  throw new Error("Total games went down vs. last run — refusing to write");

// Record the first day each line became mathematically settled. Never overwritten.
const day = gameDay();
for (const [t, [w, l]] of Object.entries(teams)) {
  const line = league.teams[t].line;
  if (!decided[t] && (w > line || 82 - l < line)) decided[t] = day;
}

writeFileSync(
  "standings.json",
  JSON.stringify({ asOf: day, teams, decided }, null, 1) + "\n"
);
console.log(`Wrote standings for ${Object.keys(teams).length} teams (${day}); decided: ${Object.keys(decided).length}`);
