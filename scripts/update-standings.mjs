// Updates standings.json from ESPN's unofficial NBA standings endpoint.
// Node 18+, no dependencies. Run from the repo root: node scripts/update-standings.mjs
// Test offline:  ESPN_FIXTURE=fixture.json node scripts/update-standings.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SEASON = process.env.SEASON || "2027"; // ESPN uses the ending year: 2026-27 -> 2027
const SEASON_TYPE = process.env.SEASON_TYPE || "2"; // 1 = preseason, 2 = regular season, 3 = postseason
const URL = `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${SEASON}&seasontype=${SEASON_TYPE}`;
const SCHEDULE_URL = (id) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${id}/schedule?season=${SEASON}&seasontype=${SEASON_TYPE}`;
const ALIAS = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };

const league = JSON.parse(readFileSync("league.json", "utf8"));
const prev = existsSync("standings.json")
  ? JSON.parse(readFileSync("standings.json", "utf8"))
  : {};
const prevTeams = prev.teams || {};
const decided = { ...(prev.decided || {}) };

// Calendar date (YYYY-MM-DD) of a moment in US Eastern time.
function etDate(when) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when);
}

// Label for asOf: before 4pm ET, the latest finished slate is yesterday's.
function lastSlate() {
  const hour = +new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23",
  }).format(new Date());
  const d = new Date(etDate(new Date()) + "T12:00:00Z");
  if (hour < 16) d.setUTCDate(d.getUTCDate() - 1);
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

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`ESPN responded ${r.status} for ${url}`);
  return r.json();
}

const num = (s) => Number(typeof s === "object" && s ? s.value ?? s.displayValue : s);

// The slate a line was decided on: walk the team's completed regular-season games
// in order and return the ET tip-off date of the game that settled it. A game that
// tips Friday night and ends after midnight still belongs to Friday's slate.
async function decidedSlate(abbr, espnId, line, [W, L]) {
  const sched = await getJson(SCHEDULE_URL(espnId));
  const games = (sched.events || [])
    .filter((ev) => { const t = typeOf(ev); return t === null || t === Number(SEASON_TYPE); })
    .map((ev) => {
      const comp = ev.competitions?.[0] || {};
      const st = comp.status?.type || ev.status?.type || {};
      if (!(st.completed ?? st.state === "post")) return null;
      const cs = comp.competitors || [];
      const us = cs.find((c) => String(c.team?.id ?? c.id) === String(espnId));
      const them = cs.find((c) => c !== us);
      if (!us || !them) return null;
      const won = typeof us.winner === "boolean" ? us.winner : num(us.score) > num(them.score);
      return { when: new Date(ev.date || comp.date), won };
    })
    .filter((g) => g && !isNaN(g.when))
    .sort((a, b) => a.when - b.when);

  let w = 0, l = 0, hit = null;
  for (const g of games) {
    g.won ? w++ : l++;
    if (!hit && (w > line || 82 - l < line)) hit = g;
  }
  if (w === W && l === L && hit) return etDate(hit.when);
  // Schedule and standings disagree (e.g. a game ESPN lists but the standings don't
  // count). Fall back to the most recent completed game, which is the deciding one
  // whenever the bot notices promptly.
  if (games.length && w + l >= W + L) {
    console.log(`::warning::${abbr} schedule shows ${w}-${l}, standings ${W}-${L}; using latest game date`);
    return etDate(games.at(-1).when);
  }
  throw new Error(`${abbr} schedule shows ${w}-${l}, standings ${W}-${L}`);
}

const data = process.env.ESPN_FIXTURE
  ? JSON.parse(readFileSync(process.env.ESPN_FIXTURE, "utf8"))
  : await getJson(URL);

const entries = collect(data);
if (!entries.length) {
  console.log(`No season-type ${SEASON_TYPE} standings yet — leaving standings.json unchanged.`);
  process.exit(0);
}
const teams = {};
const espnIds = {};
for (const e of entries) {
  const raw = e.team.abbreviation;
  const ab = ALIAS[raw] || raw;
  if (!league.teams[ab]) continue;
  const stat = (n) => {
    const s = e.stats.find((x) => x.name === n || x.type === n);
    return s ? Number(s.value ?? s.displayValue) || 0 : 0;
  };
  teams[ab] = [stat("wins"), stat("losses")];
  espnIds[ab] = e.team.id ?? raw.toLowerCase();
}

const missing = Object.keys(league.teams).filter((t) => !teams[t]);
if (missing.length) throw new Error(`No standings found for: ${missing.join(", ")}`);

const games = (o) => Object.values(o).reduce((a, [w, l]) => a + w + l, 0);
for (const [t, [w, l]] of Object.entries(teams))
  if (w + l > 82) throw new Error(`${t} shows ${w + l} games — refusing to write`);
if (games(teams) < games(prevTeams))
  throw new Error("Total games went down vs. last run — refusing to write");

// Record the slate on which each line first became mathematically settled. Never
// overwritten. If the schedule lookup fails, leave the team undecided so the next
// run retries and still finds the exact date.
for (const [t, [w, l]] of Object.entries(teams)) {
  const line = league.teams[t].line;
  if (decided[t] || !(w > line || 82 - l < line)) continue;
  try {
    decided[t] = await decidedSlate(t, espnIds[t], line, [w, l]);
    console.log(`${t} line ${line} decided on ${decided[t]}`);
  } catch (err) {
    console.log(`::warning::Couldn't date ${t}'s decided line, will retry next run: ${err.message}`);
  }
}

// `updated` = when the data last changed (not when the bot last ran), so runs that
// find nothing new leave the file untouched and the workflow doesn't commit.
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
const changed = canon(teams) !== canon(prevTeams) || canon(decided) !== canon(prev.decided || {});
const updated = changed || !prev.updated ? new Date().toISOString() : prev.updated;
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const asOf = lastSlate();
writeFileSync(
  "standings.json",
  JSON.stringify({ asOf, updated, teams: sortKeys(teams), decided: sortKeys(decided) }, null, 1) + "\n"
);
console.log(`Wrote standings for ${Object.keys(teams).length} teams (${asOf}); decided: ${Object.keys(decided).length}`);
