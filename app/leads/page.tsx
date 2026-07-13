// Server component: fetch the active book + pending candidates up front so the
// Leads page paints with data on first render (no client blank→fill).
import { listLeads, listCandidates } from "@/lib/leads/actions";
import LeadsClient from "./LeadsClient";

export default async function LeadsPage() {
  const [initialLeads, initialCandidates] = await Promise.all([
    listLeads().catch(() => []),
    listCandidates().catch(() => []),
  ]);
  return <LeadsClient initialLeads={initialLeads} initialCandidates={initialCandidates} />;
}
