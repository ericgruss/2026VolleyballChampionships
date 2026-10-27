# NCSAA Volleyball Tracker

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
Each team has its own link: `https://vb.yourdomain.com/#christian-community-oh` (team name, lowercased, dashes).

## Reuse for another tournament
Edit the data block at the top of the `<script>` in `index.html`: `EVENT`, `POOLS`, `POOL_PLAY`, `BRACKET`, `NOTES`.
Pool seeds are written `K#1`; winner/loser of a match is `W17` / `L17`.
