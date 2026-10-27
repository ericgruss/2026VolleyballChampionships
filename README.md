# NCSAA Championship Tracker

Volleyball, boys' soccer and girls' soccer for the 2026 NCSAA Soccer and Volleyball Championships.

One static page. No build step, no backend. Results people tap are saved in their own browser.

## Deploy to Azure Static Web Apps (Free plan, $0)

1. Create a GitHub repo and push these files to `main`.
2. Azure Portal > Create a resource > Static Web App.
   - Plan: Free
   - Source: GitHub, pick the repo and `main`
   - Build preset: Custom. App location: `/`. Api location: blank. Output location: blank.
3. Azure adds a GitHub Actions workflow; every push redeploys in about a minute.
4. Custom domain: Static Web App > Custom domains > Add.
   - Subdomain (e.g. `vb.yourdomain.com`): add a CNAME at your registrar pointing to the `*.azurestaticapps.net` hostname Azure shows.
   - Azure issues the SSL cert automatically.

Quick alternative without GitHub: `npm i -g @azure/static-web-apps-cli`, then `swa deploy . --env production --deployment-token <token from the portal>`.

## Team links
Each team has its own link. Volleyball: `https://brackets.webleedai.com/#christian-community-oh`. Soccer teams are prefixed: `#boys-soccer-dominion-academy-oh`, `#girls-soccer-juniata-christian-pa`. `#boys-soccer` and `#girls-soccer` open that sport's team list.

## Reuse for another tournament
Edit the data block at the top of the `<script>` in `index.html`: `EVENT`, `SPORTS`, `POOLS`, `POOL_PLAY`, `GAMES`.
Sources in `GAMES`: a team name, `K#1` (Pool K #1), `#1` (round robin #1), `W17` / `L17` (winner/loser of game 17).

## Automatic score updates
`.github/workflows/update-results.yml` runs every 10 minutes. During the tournament window
(Wed Oct 28, 6 AM ET to Sun Nov 1, 2 AM ET) it reads the NCSAA event page, matches posted results
("Team A def. Team B - 25-20, 25-18") to this site's games, writes `results.json`, and redeploys when anything changed.
Outside the window each run exits immediately.

The page loads `results.json` every minute, so W/L, scores, real opponent names, pool standings and
pool finishes fill in automatically. Manual W/L taps still work for anything not yet posted.

- Run it by hand: GitHub > Actions > Update tournament results > Run workflow.
- Lines it couldn't match confidently are listed under `unmatched` in `results.json` and in the run log; it never guesses.
- Schedule changes: it also compares each game's posted day, time, court/field and venue with this site's schedule,
  and watches for notes like "postponed", "delayed", "weather" or "moved to". The site flags any changed game for families,
  and the job opens a GitHub issue (which emails you) the first time each change appears. Results keep flowing either way;
  update the schedule in `index.html` if a change sticks.
- Tests: `node --test scripts/results.test.mjs` (six simulated tournaments plus last year's real line formats).
