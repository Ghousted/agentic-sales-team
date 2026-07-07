"""Scrape worker entrypoint: poll jobs, run browser-use, persist leads + steps."""
import asyncio
import time
from io import BytesIO
from pathlib import Path

from PIL import Image

import db
from scraper import build_task, run_scrape

# Screenshots are served by Next from agentic-salesforce/public/runs/<jobId>/.
PUBLIC_RUNS = Path(__file__).resolve().parent.parent / "public" / "runs"
POLL_SECONDS = 4


def _save_screenshot(job_id, idx, png_bytes) -> str:
    """Write a downscaled PNG, return the public path (/runs/<jobId>/step-<idx>.png)."""
    if not png_bytes:
        return ""
    out_dir = PUBLIC_RUNS / str(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"step-{idx}.png"
    try:
        img = Image.open(BytesIO(png_bytes))
        if img.width > 1000:
            ratio = 1000 / img.width
            img = img.resize((1000, int(img.height * ratio)))
        img.save(path, "PNG")
    except Exception:
        path.write_bytes(png_bytes)  # fall back to raw bytes
    return f"/runs/{job_id}/step-{idx}.png"


def run_job(conn, job):
    job_id, user_id, agent_id = job["id"], job["user_id"], job["agent_id"]
    params = job["params"] or {}
    agent = params.get("agent", {})
    target = int(params.get("target", 10))
    settings = db.get_scrape_settings(conn, user_id, agent_id)
    task = build_task(settings, agent, target)

    counters = {"steps": 0, "leadsFound": 0}

    def on_step(idx, caption, url, png_bytes):
        path = _save_screenshot(job_id, idx, png_bytes)
        db.insert_job_step(conn, job_id, user_id, idx, caption, url, path)
        counters["steps"] = idx + 1
        db.update_job_result(conn, job_id, user_id, counters)

    prospects = asyncio.run(run_scrape(task, target, on_step))

    for p in prospects:
        d = p.model_dump()
        if db.lead_exists(conn, user_id, agent_id, d.get("profileUrl")):
            continue
        db.insert_lead(conn, user_id, agent_id, d)
        counters["leadsFound"] += 1
    db.finish_job(conn, job_id, user_id, counters)
    print(f"[worker] job {job_id} done — {counters['leadsFound']} leads, {counters['steps']} steps")


def main():
    conn = db.connect()
    print("[worker] scrape worker up — polling every", POLL_SECONDS, "s")
    while True:
        try:
            job = db.claim_next_scrape_job(conn)
            if not job:
                time.sleep(POLL_SECONDS)
                continue
            print("[worker] claimed job", job["id"])
            try:
                run_job(conn, job)
            except Exception as e:  # never let one bad job kill the loop
                print("[worker] job failed:", e)
                db.fail_job(conn, job["id"], job["user_id"], str(e))
        except KeyboardInterrupt:
            print("\n[worker] shutting down")
            break
        except Exception as e:
            print("[worker] loop error:", e)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
