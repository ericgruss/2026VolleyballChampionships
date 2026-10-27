// Parses the NCSAA event page into results keyed to the tracker's own game ids.
// NCSAA edits each schedule line in place as games finish, e.g.
//   "9:00 AM - Pool K - A (OH) def. B (IN) - 25-20, 25-18"
//   "3:00 PM - Match 7 - Division 7 Quarterfinal - Court 3"  then next line  "A (OH) def. B (MI) - 25-22, 25-16"
//   "1:00 PM - Game 1 - Division 3 - A (MD) def. B (MI) - 2-1"
// The winner is listed first. Lines that can't be matched confidently are reported, never guessed.

import vm from "node:vm";

/* ---------- tournament data from index.html (single source of truth) ---------- */
export function loadData(indexHtml) {
  const start = indexHtml.indexOf("/* ===== Tournament data");
  const end = indexHtml.indexOf("/* ===== end data ===== */");
  if (start < 0 || end < 0) throw new Error("Tournament data block not found in index.html");
  const ctx = {};
  vm.runInNewContext(indexHtml.slice(start, end) + ";this.D={EVENT,SPORTS,POOLS,POOL_PLAY,GAMES};", ctx);
  const { POOLS, POOL_PLAY, GAMES } = ctx.D;
  const PP = POOL_PLAY.trim().split("\n").map((l, i) => { const [day, time, v, ct, pool, a, b] = l.split("|"); return { key: "p" + i, day, time, v, ct, pool, a: +a, b: +b }; });
  const G = {};
  for (const k in GAMES) G[k] = GAMES[k].trim().split("\n").map((l) => { const [id, div, round, day, time, v, ct, a, b] = l.split("|"); return { id, div, round, day, time, v, ct, a, b }; });
  const teams = {
    volleyball: Object.values(POOLS).flat(),
    "boys-soccer": [...new Set(G["boys-soccer"].filter((g) => g.round === "OR").flatMap((g) => [g.a, g.b]))],
    "girls-soccer": [...new Set(G["girls-soccer"].filter((g) => g.round === "RR").flatMap((g) => [g.a, g.b]))],
  };
  const poolOf = {};
  for (const p in POOLS) for (const n of POOLS[p]) poolOf[n] = p;
  return { ...ctx.D, PP, G, teams, poolOf };
}

/* ---------- HTML to lines ---------- */
const ENT = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "..." };
export function htmlToLines(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|td|th|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return String.fromCodePoint(c); }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/ /g, " ")
    .split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/* ---------- fuzzy team-name matching ---------- */
const US = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const stateOf = (n) => (n.match(/\(([A-Z]{2})\)\s*$/) || [])[1] || null;
const suffixOf = (n) => (n.replace(/\s*\([A-Z]{2}\)\s*$/, "").match(/\s-\s*([A-Z])$/) || [])[1] || null;
const core = (n) => n.replace(/\s*\([A-Z]{2}\)\s*$/, "").replace(/\s-\s*[A-Z]$/, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function dice(a, b) {
  if (a === b) return 1;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let inter = 0, tot = 0;
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) || 0); tot += v; }
  for (const v of B.values()) tot += v;
  return tot ? (2 * inter) / tot : 0;
}
function similarity(raw, cand) {
  const sr = suffixOf(raw), sc = suffixOf(cand);
  if (sr && sc && sr !== sc) return 0;
  let s = dice(core(raw), core(cand));
  if (sc && !sr) s -= 0.04;
  const st = stateOf(raw), stc = stateOf(cand);
  if (st && stc && US.has(st)) s += st === stc ? 0.15 : -0.15;
  return s;
}
// Best assignment of both posted names to two different candidates, or null if unclear.
export function matchPair(left, right, candidates) {
  const c = [...new Set(candidates)];
  if (c.length < 2) return null;
  const opts = [];
  for (const a of c) for (const b of c) if (a !== b) {
    const sa = a === left ? 2 : similarity(left, a), sb = b === right ? 2 : similarity(right, b);
    opts.push({ a, b, s: sa + sb, min: Math.min(sa, sb) });
  }
  opts.sort((x, y) => y.s - x.s);
  const [best, next] = opts;
  if (best.min < 0.35 || best.s < 1.0) return null;
  if (next && best.s - next.s < 0.08) return null;
  return [best.a, best.b];
}

export function matchTeam(raw, candidates) {
  if (!raw || !candidates.length) return null;
  const exact = candidates.find((c) => c === raw);
  if (exact) return exact;
  const ranked = candidates.map((c) => [c, similarity(raw, c)]).sort((x, y) => y[1] - x[1]);
  const [best, second] = ranked;
  const need = candidates.length <= 8 ? 0.6 : 0.82;
  if (best[1] < need) return null;
  if (second && best[1] - second[1] < 0.03) return null; // ambiguous, e.g. "Calumet Christian" vs "- A" / "- B"
  return best[0];
}

/* ---------- line parsing ---------- */
const TIME = /^(\d{1,2}:\d{2})\s*([AP]M)\s*-\s*(.*)$/i;
const CONNECT = /\s(def\.?|defeated|vs\.?|versus|tied?)\s/i;
const PLACEHOLDER = /^(Winner|Loser) of (Match|Game) \d+$|#\s*\d|^Pool [A-N]\s*-\s*#\d/i;
const STATE_END = /^(.*?\([A-Z]{2}\))\s*(.*)$/;

function placementId(sport, text) {
  const t = text.replace(/\*/g, "");
  if (sport === "girls-soccer") {
    if (/Championship Game/i.test(t)) return "GF";
    if (/Third[- ]Place Game/i.test(t)) return "GT";
    return null;
  }
  const m = t.match(/Division (\d)\s+(Championship|Third[- ]Place|Consolation 1st Place|Consolation 3rd Place)/i);
  if (!m) return null;
  const kind = /^Champ/i.test(m[2]) ? "F" : /^Third/i.test(m[2]) ? "T" : /1st/.test(m[2]) ? "C1" : "C3";
  return `D${m[1]}${kind}`;
}

function splitSide(s) {
  s = s.trim();
  if (/^(Winner|Loser) of (Match|Game) \d+/i.test(s)) { const m = s.match(/^((?:Winner|Loser) of (?:Match|Game) \d+)\s*(.*)$/i); return [m[1], m[2]]; }
  const m = s.match(STATE_END);
  if (m) return [m[1].trim(), m[2]];
  // No state: take up to " - " followed by a score, a court/field, or end.
  const k = s.search(/\s-+\s*(\d+\s*-\s*\d+|Court|Field)/i);
  return k >= 0 ? [s.slice(0, k).trim(), s.slice(k)] : [s, ""];
}

function parseMatchup(text, stripPrefix) {
  let t = text.replace(/\*/g, "").trim();
  if (stripPrefix) {
    for (let i = 0; i < 4; i++) {
      const n = t.replace(/^(Game \d+|Match \d+|Pool [A-N]|Division [\d/]+[^-]*?)\s*-+\s*/i, "");
      if (n === t) break; t = n;
    }
  }
  const c = t.match(CONNECT);
  if (!c) return null;
  const left = t.slice(0, c.index).trim();
  const [right, rest] = splitSide(t.slice(c.index + c[0].length));
  if (!left || !right) return null;
  const scoreText = rest.replace(/[-\s]*(Court|Field)\s*\d+\s*$/i, "").replace(/^[\s-]+/, "").trim();
  const score = /\d+\s*-\s*\d+/.test(scoreText) ? scoreText : "";
  const placeholder = PLACEHOLDER.test(left) || PLACEHOLDER.test(right);
  return { left, right, conn: c[1].toLowerCase().replace(/\.$/, ""), score, placeholder };
}

function decide(sport, m, isRoundRobin) {
  if (m.placeholder) return { winner: null, tie: false };
  if (m.conn === "tie" || m.conn === "tied") return { winner: null, tie: true };
  if (!m.score) return { winner: m.conn.startsWith("def") ? "L" : null, tie: false };
  const pairs = [...m.score.matchAll(/(\d+)\s*-\s*(\d+)/g)].map((p) => [+p[1], +p[2]]);
  const extraTime = /OT|PK|shoot/i.test(m.score);
  if (sport === "volleyball") {
    const a = pairs.filter(([x, y]) => x > y).length, b = pairs.filter(([x, y]) => y > x).length;
    if (m.conn.startsWith("def")) return { winner: "L", tie: false };
    return { winner: a > b ? "L" : b > a ? "R" : null, tie: false };
  }
  const [x, y] = pairs[0];
  if (x === y && !extraTime && isRoundRobin && !m.conn.startsWith("def")) return { winner: null, tie: true };
  if (m.conn.startsWith("def")) return { winner: "L", tie: false };
  return { winner: x > y ? "L" : y > x ? "R" : extraTime ? "L" : null, tie: false };
}

// Words that suggest NCSAA posted a schedule note (weather, delays, moves).
const NOTICE = /postpon|cancel|delay|weather|rain\b|lightning|storm|moved to|relocat|reschedul|schedule change|updated schedule|time change/i;

export function parseLines(lines) {
  const recs = [];
  recs.slots = []; recs.notices = [];
  let sport = null, pending = null, day = null, venue = null;
  const DAYS = { wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat" };
  for (const line of lines) {
    const dm = line.match(/^(Wednesday|Thursday|Friday|Saturday),/i);
    if (dm) { day = DAYS[dm[1].toLowerCase()]; venue = null; pending = null; continue; }
    if (sport && line.length < 140 && /\bat ATHLETES IN ACTION\b/i.test(line)) { venue = "aia"; continue; }
    if (sport && line.length < 140 && /\bat CEDARVILLE\b/i.test(line)) { venue = "ced"; continue; }
    if (sport && NOTICE.test(line)) recs.notices.push(line);
    if (/Girls'? Varsity Soccer/i.test(line) && line.length < 60) { sport = "girls-soccer"; pending = null; continue; }
    if (/Boys'? Varsity Soccer/i.test(line) && line.length < 60) { sport = "boys-soccer"; pending = null; continue; }
    if (/Girls'? Varsity Volleyball/i.test(line) && line.length < 60) { sport = "volleyball"; pending = null; continue; }
    if (!sport) continue;
    const tm = line.match(TIME);
    if (tm) {
      pending = null;
      const rest = tm[3];
      const time = `${+tm[1].split(":")[0]}:${tm[1].split(":")[1]} ${tm[2].toUpperCase()}`;
      const court = (rest.match(/\b(?:Court|Field)\s*(\d+)/i) || [])[1] || null;
      const where = { day, time, court, venue: sport === "volleyball" ? venue : null };
      let ref = null;
      const pool = sport === "volleyball" && rest.match(/^Pool ([A-N])\s*-\s*/i);
      const num = rest.match(/\b(?:Match|Game)\s+(\d+)\b/i);
      if (pool) ref = { type: "pool", pool: pool[1].toUpperCase(), ...where };
      else if (num) ref = { type: "game", id: num[1], ...where };
      else { const pid = placementId(sport, rest); if (pid) ref = { type: "game", id: pid, ...where }; }
      if (!ref) continue;
      if (ref.type === "game") recs.slots.push({ sport, ref, line });
      const m = parseMatchup(rest, true);
      if (m) recs.push({ sport, ref, ...m, line });
      else pending = { sport, ref };
      continue;
    }
    if (pending) {
      const m = parseMatchup(line, false);
      if (m) recs.push({ ...pending, ...m, line });
      pending = null;
    }
  }
  return recs;
}

/* ---------- resolve records to canonical teams and game ids ---------- */
export function resolve(recs, D) {
  const out = { volleyball: { pool: {}, seeds: {}, games: {}, changes: {} }, "boys-soccer": { games: {}, changes: {} }, "girls-soccer": { games: {}, changes: {} } };
  const unmatched = [];
  // Compare what NCSAA lists now with the schedule this site was built from.
  const VENUE = { aia: "Athletes in Action", aiaf: "Athletes in Action", ced: "Cedarville University" };
  const DAYN = { wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  const diff = (sport, key, planned, ref, line) => {
    const was = [], now = [];
    if (ref.day && ref.time && (ref.day !== planned.day || ref.time !== planned.time)) { was.push(`${DAYN[planned.day]} ${planned.time}`); now.push(`${DAYN[ref.day]} ${ref.time}`); }
    if (ref.court && ref.court !== planned.ct) { const u = sport === "volleyball" ? "Court" : "Field"; was.push(`${u} ${planned.ct}`); now.push(`${u} ${ref.court}`); }
    if (ref.venue && planned.v !== "aiaf" && ref.venue !== planned.v) { was.push(VENUE[planned.v]); now.push(VENUE[ref.venue]); }
    if (now.length) out[sport].changes[key] = { was: was.join(" · "), now: now.join(" · "), line };
  };
  for (const s of recs.slots || []) {
    const g = D.G[s.sport].find((x) => x.id === s.ref.id);
    if (g) diff(s.sport, g.id, g, s.ref, s.line);
  }
  const gameRecs = {};
  for (const r of recs) {
    if (r.ref.type === "pool") {
      const cands = D.POOLS[r.ref.pool] || [];
      const inPool = D.PP.filter((p) => p.pool === r.ref.pool);
      const atTime = inPool.filter((p) => p.day === r.ref.day && p.time === r.ref.time);
      // Prefer the games scheduled at that day and time; fall back to the whole pool.
      let pick = null;
      for (const set of [atTime, inPool]) {
        if (!set.length) continue;
        const names = [...new Set(set.flatMap((p) => [cands[p.a], cands[p.b]]))];
        const pr = matchPair(r.left, r.right, names);
        if (!pr) continue;
        const [iL, iR] = pr.map((n) => cands.indexOf(n));
        const pp = set.find((p) => (p.a === iL && p.b === iR) || (p.a === iR && p.b === iL));
        if (pp) { pick = { pp, L: pr[0], R: pr[1] }; break; }
      }
      if (!pick) { unmatched.push(r.line); continue; }
      const { pp, L, R } = pick;
      diff("volleyball", pp.key, pp, r.ref, r.line);
      const d = decide("volleyball", r, false);
      out.volleyball.pool[pp.key] = { teams: [L, R], winner: d.winner ? (d.winner === "L" ? L : R) : null, score: r.score };
    } else {
      (gameRecs[r.sport] ||= {})[r.ref.id] = r;
    }
  }

  for (const sport of Object.keys(gameRecs)) {
    const games = D.G[sport], byId = Object.fromEntries(games.map((g) => [g.id, g]));
    const res = out[sport].games, seeds = out[sport].seeds;
    const all = D.teams[sport];
    const cands = (src, depth = 0) => {
      if (depth > 8) return all;
      let m = /^([A-N])#(\d)$/.exec(src);
      if (m) return seeds?.[src] ? [seeds[src]] : D.POOLS[m[1]];
      if (/^#\d$/.test(src)) return all;
      m = /^([WL])(\w+)$/.exec(src);
      if (m && byId[m[2]] && !all.includes(src)) {
        const r = res[m[2]];
        if (r && r.winner) return [m[1] === "W" ? r.winner : r.loser];
        const g = byId[m[2]];
        return [...new Set([...cands(g.a, depth + 1), ...cands(g.b, depth + 1)])];
      }
      return [src];
    };
    const order = games.map((g) => g.id).filter((id) => gameRecs[sport][id]);
    for (const id of Object.keys(gameRecs[sport])) if (!byId[id]) unmatched.push(gameRecs[sport][id].line);
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const id of order) {
        const r = gameRecs[sport][id], g = byId[id];
        const pool = [...new Set([...cands(g.a), ...cands(g.b)])];
        if (r.placeholder) continue; // nothing posted yet
        const pr = matchPair(r.left, r.right, pool);
        if (!pr) continue;
        const [L, R] = pr;
        const d = decide(sport, r, g.round === "RR");
        const winner = d.winner ? (d.winner === "L" ? L : R) : null;
        const next = { teams: [L, R], winner, loser: winner ? (winner === L ? R : L) : null, tie: d.tie || undefined, score: r.score };
        if (JSON.stringify(res[id]) !== JSON.stringify(next)) { res[id] = next; changed = true; }
        if (sport === "volleyball" && g.round === "QF") {
          for (const team of [L, R]) for (const src of [g.a, g.b]) {
            const m = /^([A-N])#\d$/.exec(src);
            if (m && D.poolOf[team] === m[1] && seeds[src] !== team) { seeds[src] = team; changed = true; }
          }
        }
      }
      if (!changed) break;
    }
    // Volleyball: quarterfinal matchups posted before play still reveal pool finishes.
    if (sport === "volleyball") for (const id of order) {
      const r = gameRecs[sport][id], g = byId[id];
      if (g.round !== "QF" || res[id]) continue;
      if (r.placeholder) continue;
      const pr = matchPair(r.left, r.right, [...cands(g.a), ...cands(g.b)]);
      if (pr) for (const team of pr) for (const src of [g.a, g.b]) {
        const m = /^([A-N])#\d$/.exec(src);
        if (m && D.poolOf[team] === m[1]) seeds[src] = team;
      }
    }
    for (const id of order) {
      const r = gameRecs[sport][id];
      if (!r.placeholder && !res[id] && (r.score || r.conn.startsWith("def"))) unmatched.push(r.line);
    }
  }
  return { results: out, unmatched, notices: [...new Set(recs.notices || [])] };
}

/* ---------- stable JSON ---------- */
export function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, stable(v[k])]));
  return v;
}
