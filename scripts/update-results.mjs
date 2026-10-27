// Fetches the NCSAA event page, parses posted results and writes results.json.
// Usage: node scripts/update-results.mjs [--html file] [--force]
// Runs only inside the tournament window unless --force (or FORCE=1) is set.
// Sets "changed=true|false" in $GITHUB_OUTPUT when running in GitHub Actions.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { loadData, htmlToLines, parseLines, resolve, stable } from "./results-lib.mjs";

const WINDOW_START = new Date("2026-10-28T10:00:00Z"); // Wed 6:00 AM ET
const WINDOW_END = new Date("2026-11-01T06:00:00Z");   // Sun 2:00 AM ET (after Saturday's last results)

const args = process.argv.slice(2);
const force = args.includes("--force") || process.env.FORCE === "1";
const htmlFile = args.includes("--html") ? args[args.indexOf("--html") + 1] : null;
const out = async (k, v) => { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

const now = new Date();
if (!force && (now < WINDOW_START || now > WINDOW_END)) {
  console.log(`Outside tournament window (${WINDOW_START.toISOString()} to ${WINDOW_END.toISOString()}); nothing to do.`);
  await out("changed", "false");
  process.exit(0);
}

const D = loadData(await readFile("index.html", "utf8"));
let html;
if (htmlFile) html = await readFile(htmlFile, "utf8");
else {
  const res = await fetch(D.EVENT.source, { headers: { "User-Agent": "brackets.webleedai.com results updater (unofficial fan tracker)" } });
  if (!res.ok) { console.error(`NCSAA page returned ${res.status}; keeping previous results.`); await out("changed", "false"); process.exit(0); }
  html = await res.text();
}

const lines = htmlToLines(html);
const recs = parseLines(lines);
const { results, unmatched, notices } = resolve(recs, D);

let prev = null;
try { prev = JSON.parse(await readFile("results.json", "utf8")); } catch {}
const body = stable({ ...results, notices, unmatched: [...new Set(unmatched)] });
const same = prev && JSON.stringify(stable({ ...prev, updated: undefined, source: undefined })) === JSON.stringify(body);

const counts = Object.entries(results).map(([k, v]) => `${k}: ${Object.keys(v.games).length} games` + (v.pool ? `, ${Object.keys(v.pool).length} pool` : "") + (v.seeds ? `, ${Object.keys(v.seeds).length} seeds` : "")).join(" | ");
console.log(`Parsed ${recs.length} schedule lines. ${counts}`);
if (unmatched.length) console.log(`Could not match ${unmatched.length} line(s):\n  ` + [...new Set(unmatched)].join("\n  "));

/* Flag new schedule changes or notes (once each) */
const changeKeys = (r) => r ? Object.entries(r).flatMap(([sp, v]) => Object.entries(v?.changes || {}).map(([id, c]) => `${sp}|${id}|${c.now}`)) : [];
const prevKeys = new Set([...changeKeys(prev), ...(prev?.notices || [])]);
const freshChanges = Object.entries(results).flatMap(([sp, v]) => Object.entries(v.changes).filter(([id, c]) => !prevKeys.has(`${sp}|${id}|${c.now}`)).map(([id, c]) => ({ sp, id, ...c })));
const freshNotices = notices.filter((n) => !prevKeys.has(n));
if (freshChanges.length || freshNotices.length) {
  const label = { volleyball: "Volleyball", "boys-soccer": "Boys' soccer", "girls-soccer": "Girls' soccer" };
  const md = ["The results updater noticed differences between the NCSAA page and the schedule this site was built from.", "",
    ...(freshChanges.length ? ["**Schedule changes** (the site now flags these games for families):", "", ...freshChanges.map((c) => `- ${label[c.sp]} ${/^p\d+$/.test(c.id) ? "pool game" : "game " + c.id}: was ${c.was}, now **${c.now}**  \n  \`${c.line}\``), ""] : []),
    ...(freshNotices.length ? ["**Schedule notes on the NCSAA page:**", "", ...freshNotices.map((n) => `- ${n}`), ""] : []),
    `Check ${D.EVENT.source} and update the schedule in index.html if needed.`].join("\n");
  await writeFile("schedule-alert.md", md);
  console.log(md);
  await out("alert", "true");
}

if (same) { console.log("No changes."); await out("changed", "false"); process.exit(0); }
await writeFile("results.json", JSON.stringify(stable({ updated: now.toISOString(), source: D.EVENT.source, ...body }), null, 1) + "\n");
console.log("results.json updated.");
await out("changed", "true");
