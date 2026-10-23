// Time-of-day greeting for the dashboard, from the viewer's local hour (0–23).
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

// Hub scale from the hub card's measured size. The hub is drawn at 760×524
// and scaled to fit, between 0.7 and 1.45.
export function hubScaleFor(cardW: number, cardH: number): number {
  return Math.max(0.7, Math.min((cardH - 72) / 524, (cardW - 40) / 760, 1.45));
}
