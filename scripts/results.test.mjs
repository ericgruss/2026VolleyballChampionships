// node --test scripts/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadData, htmlToLines, parseLines, resolve, matchTeam, matchPair } from "./results-lib.mjs";

const D = loadData(readFileSync(new URL("../index.html", import.meta.url), "utf8"));

/* Deterministic random */
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const vbScore = () => (rnd() < 0.3 ? "25-21, 22-25, 15-11" : "25-18, 25-20");
// Mimic NCSAA's inconsistent naming: drop state, swap state, small typos.
const core = (n) => n.replace(/\s*\([A-Z]{2}\)$/, "");
const twins = new Set(Object.values(D.teams).flatMap((ts) => ts.filter((a) => ts.some((b) => b !== a && core(b) === core(a)))));
// NCSAA keeps states on look-alike names (e.g. the two Wilmington Christians), so noise skips those.
const noisy = (n) => { if (twins.has(n)) return n; const r = rnd(); if (r < 0.15) return n.replace(/ \([A-Z]{2}\)$/, ""); if (r < 0.25) return n.replace(/\(([A-Z]{2})\)$/, "(ZZ)"); if (r < 0.32) return n.replace("Christian", "Christain"); return n; };
const label = { QF: "Quarterfinal", SF: "Semifinal", CO: "Consolation Bracket", CS: "Consolation", F: "Championship", T: "Third-Place Match", C1: "Consolation 1st Place", C3: "Consolation 3rd Place" };

function simulate() {
  const truth = { pool: {}, games: { volleyball: {}, "boys-soccer": {}, "girls-soccer": {} }, seeds: {} };
  const lines = ["<p>Girls' Varsity Volleyball:</p>"];
  // Pool play
  const wins = {};
  const DAYNAME = { wed: "Wednesday, October 28:", thu: "Thursday, October 29:", fri: "Friday, October 30:", sat: "Saturday, October 31:" };
  let lastDay = null;
  for (const p of D.PP) {
    if (p.day !== lastDay) { lines.push(`<p>${DAYNAME[p.day]}</p>`); lastDay = p.day; }
    const A = D.POOLS[p.pool][p.a], B = D.POOLS[p.pool][p.b];
    const [w, l] = rnd() < 0.5 ? [A, B] : [B, A];
    wins[w] = (wins[w] || 0) + 1; wins[l] ||= 0;
    truth.pool[p.key] = w;
    const conn = rnd() < 0.1 ? "vs." : "def.";
    lines.push(`${p.time} - Pool ${p.pool} - ${noisy(w)} ${conn} ${noisy(l)} - ${vbScore()}<br>`);
  }
  for (const p in D.POOLS) [...D.POOLS[p]].sort((x, y) => wins[y] - wins[x] || x.localeCompare(y)).forEach((t, i) => (truth.seeds[`${p}#${i + 1}`] = t));
  // Bracket games, in id order where sources resolve
  for (const sport of ["volleyball", "boys-soccer", "girls-soccer"]) {
    if (sport === "boys-soccer") lines.push("<p>Boys' Varsity Soccer:</p>");
    if (sport === "girls-soccer") lines.push("<p>Girls' Varsity Soccer:</p>");
    const G = D.G[sport], res = truth.games[sport];
    const rrWins = {};
    const who = (src) => { let m = /^([A-N])#\d$/.exec(src); if (m) return truth.seeds[src]; m = /^#(\d)$/.exec(src); if (m) return Object.keys(rrWins).sort((x, y) => rrWins[y] - rrWins[x] || x.localeCompare(y))[+m[1] - 1]; m = /^([WL])(\w+)$/.exec(src); if (m && res[m[2]]) return m[1] === "W" ? res[m[2]].w : res[m[2]].l; return src; };
    let left = [...G];
    for (let guard = 0; left.length && guard < 20; guard++) {
      left = left.filter((g) => {
        const A = who(g.a), B = who(g.b);
        if (!A || !B || /^[WL]\d|^#/.test(A) || /^[WL]\d|^#/.test(B)) return true;
        const [w, l] = rnd() < 0.5 ? [A, B] : [B, A];
        res[g.id] = { w, l };
        if (g.round === "RR") { rrWins[w] = (rrWins[w] || 0) + 1; rrWins[l] ||= 0; }
        const sc = sport === "volleyball" ? vbScore() : rnd() < 0.1 ? "1-1 (OT / PK's)" : "2-1";
        const div = g.div ? `Division ${g.div} ` : "";
        if (/^\d+$/.test(g.id) && sport !== "volleyball") lines.push(`${g.time} - Game ${g.id} - ${g.div ? "Division " + g.div + " - " : ""}${noisy(w)} def. ${noisy(l)} - ${sc}<br>`);
        else {
          const head = /^\d+$/.test(g.id) ? `Match ${g.id} - <em>${div}${label[g.round]}</em>` : sport === "girls-soccer" ? `*${g.round === "F" ? "Championship Game" : "Third-Place Game"}*` : `<em>${div}${label[g.round]}</em>`;
          lines.push(`${g.time} - ${head} - Court 1<br>&nbsp; ${noisy(w)} def. ${noisy(l)} - <strong>${sc}</strong><br>`);
        }
        return false;
      });
    }
  }
  return { html: lines.join("\n"), truth };
}

for (const s0 of [7, 42, 99, 1234, 2026, 31337]) test(`simulated full tournament parses back exactly (seed ${s0})`, () => {
  seed = s0;
  const { html, truth } = simulate();
  const { results, unmatched } = resolve(parseLines(htmlToLines(html)), D);
  for (const k in truth.pool) assert.equal(results.volleyball.pool[k]?.winner, truth.pool[k], `pool ${k}`);
  for (const k in truth.seeds) assert.equal(results.volleyball.seeds[k], truth.seeds[k], `seed ${k}`);
  for (const sport in truth.games) for (const id in truth.games[sport]) {
    assert.equal(results[sport].games[id]?.winner, truth.games[sport][id].w, `${sport} ${id} winner`);
    assert.equal(results[sport].games[id]?.loser, truth.games[sport][id].l, `${sport} ${id} loser`);
  }
  assert.equal(Object.keys(results.volleyball.pool).length, D.PP.length);
  assert.deepEqual(unmatched, []);
});

test("schedule with no results yields nothing and no false matches", () => {
  const html = `<p>Girls' Varsity Volleyball:</p>9:00 AM - Pool A - CVHAA Patriots (VA) vs. Anderson Angels (IN) - Court 1<br>
3:00 PM - Match 5 - <em>Division 7 Quarterfinal</em> - Court 1<br>Pool N - #3 vs. Pool L - #4<br>
9:00 AM - Match 29 - <em>Division 5 Semifinal</em> - Court 1<br>Winner of Match 17 vs. Winner of Match 18<br>
<p>Boys' Varsity Soccer:</p>9:00 AM - Game 21 - Division 4 - Winner of Game 5 vs. Winner of Game 9 - Field 1<br>`;
  const { results, unmatched } = resolve(parseLines(htmlToLines(html)), D);
  assert.equal(results.volleyball.pool.p0?.winner ?? null, null);
  assert.equal(Object.keys(results.volleyball.seeds).length, 0);
  assert.equal(Object.keys(results["boys-soccer"].games).length, 0);
  assert.deepEqual(unmatched, []);
});

test("quarterfinal names posted before play set pool finishes", () => {
  const html = `<p>Girls' Varsity Volleyball:</p>3:00 PM - Match 7 - <em>Division 7 Quarterfinal</em> - Court 3<br>Sugar Creek Christian (OH) vs. Christian Community (OH)<br>`;
  const { results } = resolve(parseLines(htmlToLines(html)), D);
  assert.equal(results.volleyball.seeds["K#4"], "Christian Community (OH)");
  assert.equal(results.volleyball.seeds["M#3"], "Sugar Creek Christian (OH)");
});

test("last year's real line formats", () => {
  // Lines copied from the 2025 NCSAA page (team names differ from 2026, so only parsing is checked).
  const lines = htmlToLines(`<p>Boys' Varsity Soccer:</p>
1:00 PM - Game 1 - Division 3 - Calvary Christian (MD) def. Algoma Christian (MI) - <span><strong>2-1</strong></span><br>
2:45 PM - Game 8 - Division 5 - Pittsburgh Christian (PA) def. Chautauqua Christian (NY) - 1-1 (OT / shootout)<br>
4:30 PM - Game 10 - Division 1/2 - Mitigator FC - A (IN) vs. Temple Academy (TN) - 3-0<br>
6:15 PM - Game 13 - Division 4 - Assumption Academy (KY) def. Georgia Cumberland Academy - B (GA)<br>
10:00 AM - Division 5 Third-Place Game - Field 2<br>Plants and Pillars (PA) def. Pittsburgh Christian (PA) - 1-0<br>
<p>Girls' Varsity Volleyball:</p>
9:00 AM - Pool I - Mountain View Christian (VA) vs. Monclova Christian (OH) - 25-21, 25-11<br>
3:00 PM - Match 2 - Division 1 Quarterfinal - Court 2<br>Grace Academy (MD) def. Frederick Force (MD) -- 25-16, 25-12<br>
12:00 PM- Match 37 - Division 4 Semifinal - Court 1<br>Faith Christian (WV) def. Pittsburgh Christian (PA) - 25-16, 25-18<br>
2:00 PM - Division 5 Championship Match - Court 1<br>
2:00 PM - Division 5 Third-Place Match - Court 2<br>Heritage Classical (OH) def. Indy Metro Mustangs - B (IN) - 25-21, 25-9<br>`);
  const r = parseLines(lines);
  const pick = (id) => r.find((x) => x.ref.id === id || x.ref.pool === id);
  assert.equal(pick("1").right, "Algoma Christian (MI)"); assert.equal(pick("1").score, "2-1");
  assert.equal(pick("8").score, "1-1 (OT / shootout)");
  assert.equal(pick("10").left, "Mitigator FC - A (IN)"); assert.equal(pick("10").conn, "vs");
  assert.equal(pick("13").right, "Georgia Cumberland Academy - B (GA)"); assert.equal(pick("13").score, "");
  assert.equal(pick("D5T").left, "Plants and Pillars (PA)");
  assert.equal(pick("I").left, "Mountain View Christian (VA)");
  assert.equal(pick("2").score, "25-16, 25-12");
  assert.equal(pick("37").right, "Pittsburgh Christian (PA)");
  assert.equal(r.filter((x) => x.ref.id === "D5F").length, 0, "a header with no result line is skipped");
});

test("name matching handles NCSAA variations and refuses ambiguity", () => {
  assert.equal(matchTeam("Community Baptist Christian (IN)", D.POOLS.K), "Community Baptist (IN)");
  assert.equal(matchTeam("Bishop Walsh (NY)", D.POOLS.J), "Bishop Walsh (MD)");
  assert.deepEqual(matchPair("Heritage Christian (MD)", "Eukarya Christian (VA)", D.POOLS.C), ["Heritage Academy (MD)", "Eukarya Christian (VA)"]);
  assert.deepEqual(matchPair("Wilmington Christian (NC)", "Wilmington Christian (OH)", D.POOLS.E), ["Wilmington Christian (NC)", "Wilmington Christian (OH)"]);
  assert.equal(matchPair("Wilmington Christian", "Wilmington Christian", D.POOLS.E), null);
  assert.equal(matchTeam("Indy Metro Mustangs (IN)", ["Indy Metro Mustangs - A (IN)", "Indy Metro Mustangs - B (IN)"]), null);
  assert.equal(matchTeam("Totally Different School (TX)", D.POOLS.K), null);
});
