// Each agent runs each capability on Ask or Auto: the agent page's Autonomy
// toggle, stored in agent_config.settings[cap].mode. Ask is the default, so the
// team chat asks Proceed/Cancel before the step runs. Auto skips the ask and
// starts the step at once. Pure, so the page and the server read it the same way.

export type CapMode = "auto" | "ask";
type Settings = Record<string, Record<string, unknown> | undefined> | null | undefined;

/** Only an explicitly saved Auto runs without asking. */
export function capMode(settings: Settings, cap: string): CapMode {
  return settings?.[cap]?.mode === "auto" ? "auto" : "ask";
}

/** The capabilities this agent runs on Auto. */
export function autoCaps(settings: Settings): string[] {
  return Object.keys(settings ?? {}).filter((cap) => capMode(settings, cap) === "auto");
}
