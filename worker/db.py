"""Neon Postgres access for the scrape worker. Raw SQL against the exact
snake_case column names in agentic-salesforce/lib/db/schema.ts."""
import json
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# The app's .env.local lives one dir up (agentic-salesforce/.env.local).
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

DATABASE_URL = os.environ.get("DATABASE_URL")


def connect() -> psycopg.Connection:
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL missing (expected in agentic-salesforce/.env.local)")
    # autocommit: each helper is its own unit of work, simplest for a poller.
    return psycopg.connect(DATABASE_URL, autocommit=True)


def claim_next_scrape_job(conn) -> dict | None:
    """Atomically claim the oldest queued scrape job. Returns None if none."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs SET status='running', started_at=now()
            WHERE id = (
              SELECT id FROM jobs
              WHERE status='queued' AND kind='scrape'
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, user_id, agent_id, params
            """
        )
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "user_id": row[1], "agent_id": row[2], "params": row[3]}


def get_scrape_settings(conn, user_id, agent_id) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT settings FROM agent_config WHERE user_id=%s AND agent_id=%s",
            (user_id, agent_id),
        )
        row = cur.fetchone()
    settings = (row[0] if row else None) or {}
    return settings.get("scrape", {}) if isinstance(settings, dict) else {}


def lead_exists(conn, user_id, agent_id, profile_url) -> bool:
    if not profile_url:
        return False
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM leads WHERE user_id=%s AND agent_id=%s AND profile_url=%s LIMIT 1",
            (user_id, agent_id, profile_url),
        )
        return cur.fetchone() is not None


def insert_lead(conn, user_id, agent_id, prospect: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO leads (user_id, agent_id, name, title, company, email,
                               source, profile_url, platform)
            VALUES (%s, %s, %s, %s, %s, %s, 'scrape', %s, %s)
            """,
            (
                user_id, agent_id,
                prospect.get("name", "").strip() or "Unknown",
                prospect.get("title", "") or "",
                prospect.get("company", "") or "",
                prospect.get("email", "") or "",
                prospect.get("profileUrl", "") or "",
                prospect.get("platform", "") or "",
            ),
        )


def insert_job_step(conn, job_id, user_id, idx, caption, url, screenshot_path) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO job_steps (job_id, user_id, idx, caption, url, screenshot_path)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (job_id, user_id, idx, caption[:500], url[:1000], screenshot_path),
        )


def update_job_result(conn, job_id, user_id, result: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET result=%s WHERE id=%s AND user_id=%s",
            (json.dumps(result), job_id, user_id),
        )


def finish_job(conn, job_id, user_id, result: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status='done', finished_at=now(), result=%s WHERE id=%s AND user_id=%s",
            (json.dumps(result), job_id, user_id),
        )


def fail_job(conn, job_id, user_id, error: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status='failed', finished_at=now(), error=%s WHERE id=%s AND user_id=%s",
            (error[:500], job_id, user_id),
        )


if __name__ == "__main__":
    # Self-test: connectivity + how many scrape jobs are queued.
    c = connect()
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM jobs WHERE kind='scrape' AND status='queued'")
        print("DB OK — queued scrape jobs:", cur.fetchone()[0])
