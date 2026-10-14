// Server component: fetch dashboard stats + recent activity up front so the
// hero and team cards paint with real numbers on first render.
import { getWorkspaceStats, listActivity } from "@/lib/workspace/statsActions";
import HomeClient from "./HomeClient";

export default async function Home() {
  const [initialStats, initialActs] = await Promise.all([
    getWorkspaceStats().catch(() => null),
    listActivity(6).catch(() => []),
  ]);
  return <HomeClient initialStats={initialStats} initialActs={initialActs} />;
}
