// Server component: fetch the KPI aggregates + recent activity up front so the
// analytics charts and ranking paint with data on first render.
import { getWorkspaceStats, listActivity } from "@/lib/workspace/statsActions";
import AnalyticsClient from "./AnalyticsClient";

export default async function AnalyticsPage() {
  const [initialStats, initialActs] = await Promise.all([
    getWorkspaceStats().catch(() => null),
    listActivity(8).catch(() => []),
  ]);
  return <AnalyticsClient initialStats={initialStats} initialActs={initialActs} />;
}
