"""Browser-use + Gemini scrape engine. Given an ICP task, drives a real browser
to find prospects and returns structured Prospect rows. Emits per-step frames
via an on_step callback. Verified against browser-use 0.13.3."""
import base64
import os
from pathlib import Path

from pydantic import BaseModel

from browser_use import Agent, ChatGoogle, BrowserProfile, BrowserSession

PROFILE_DIR = str(Path(__file__).resolve().parent / ".browser-profile")

READ_ONLY_GUARD = (
    "You are in STRICT READ-ONLY research mode. You may ONLY navigate, scroll, "
    "open pages, and read/extract information. You must NEVER interact with any "
    "account or content: do not post, comment, reply, message, DM, react, like, "
    "follow, friend, connect, join, submit any form, sign in, change any setting, "
    "or click any button that writes, sends, or publishes. If a step seems to "
    "require any such action, skip it and try a different source instead. Never "
    "take an action that modifies state on any site, especially logged-in accounts."
)


class Prospect(BaseModel):
    name: str
    title: str = ""
    company: str = ""
    profileUrl: str = ""
    platform: str = ""
    email: str = ""  # found-only; blank unless visibly on the page


class Prospects(BaseModel):
    prospects: list[Prospect]


def build_task(settings: dict, agent: dict, target: int) -> str:
    industry = (settings.get("industry") or "").strip()
    titles = (settings.get("titles") or "").strip()
    geo = (settings.get("geo") or "").strip()
    icp_lines = []
    if industry: icp_lines.append(f"- Industry / market: {industry}")
    if titles: icp_lines.append(f"- Job titles / roles: {titles}")
    if geo: icp_lines.append(f"- Geography: {geo}")
    icp = "\n".join(icp_lines) or f"- Fit for this agent's goal: {agent.get('goal', '')}"
    return f"""You are a lead-research assistant. Find up to {target} real sales
prospects that match this ideal customer profile:
{icp}

Search across Reddit, the public web, and open directories. If you are logged in
to Facebook, you may also use Facebook groups/pages. Prefer sources that expose a
person's name, role, company, and a link to their profile or page.

For each prospect capture: name, title, company, a profileUrl (link to their
profile/page — REQUIRED), and the platform it came from (reddit / facebook / web).
Only include an email if it is VISIBLY shown on the page — never guess or
construct one; leave it blank otherwise.

Stop when you have {target} prospects or you have exhausted reasonable sources.
Return them as structured data."""


async def run_scrape(task: str, target: int, on_step) -> list[Prospect]:
    max_steps = min(60, 6 * target + 10)
    # Persistent, headed profile → reuses the user's logged-in sessions (Facebook, etc.).
    session = BrowserSession(
        browser_profile=BrowserProfile(user_data_dir=PROFILE_DIR, headless=False)
    )

    counter = {"i": 0}

    async def _on_step(browser_state_summary, agent_output, step_number):
        i = counter["i"]
        counter["i"] += 1
        caption = (getattr(agent_output, "next_goal", "")
                   or getattr(agent_output, "thinking", "") or "").strip()
        url = getattr(browser_state_summary, "url", "") or ""
        png = None
        b64 = getattr(browser_state_summary, "screenshot", None)
        if b64:
            try:
                png = base64.b64decode(b64)
            except Exception:
                png = None
        try:
            on_step(i, caption or f"Step {i + 1}", url, png)
        except Exception:
            pass

    agent = Agent(
        task=task,
        llm=ChatGoogle(model="gemini-2.5-flash",
                       api_key=os.environ.get("GEMINI_API_KEY"),
                       thinking_budget=0),
        browser_session=session,
        output_model_schema=Prospects,
        register_new_step_callback=_on_step,
        extend_system_message=READ_ONLY_GUARD,
    )
    history = await agent.run(max_steps=max_steps)
    result = history.structured_output  # property → Prospects | None
    if result:
        return result.prospects
    return []
