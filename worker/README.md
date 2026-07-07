# Scrape Worker

Local Python worker that runs the `scrape` capability: it polls the `jobs` table
for `kind='scrape'`, drives a real browser (browser-use + Gemini) to find
ICP-matched prospects, and writes them to `leads` (plus per-step screenshots to
`job_steps` + `../public/runs/`). It shares nothing with the Next.js app but the
database and the `public/runs/` folder.

## Setup (one-time)

```bash
cd agentic-salesforce/worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Reads `DATABASE_URL` and `GEMINI_API_KEY` from `../.env.local`.

browser-use (0.13.x) drives a local **Google Chrome** via CDP — it uses an
installed Chrome (or downloads a Chromium on first run). No `playwright install`
step is needed. If the first run reports it can't find a browser, install Google
Chrome (or run the `browser-use` CLI once to let it fetch one).

### Log in to Facebook (once)

The worker uses a persistent browser profile at `./.browser-profile/` so it can
act on your own logged-in sessions. On the first run it opens a real (headed)
Chrome; log into Facebook (and any other platform you want reachable) in that
window. Those cookies persist for future runs.

> Note: automating a logged-in Facebook account can violate Facebook's terms and
> risk account restrictions. This is your account — use at your discretion.

## Run

```bash
source .venv/bin/activate
python main.py
```

Leave it running. Click **Find leads** on a scrape-capable agent in the app to
enqueue a job; the worker picks it up within a few seconds.
