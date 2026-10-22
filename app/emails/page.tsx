// Server component: fetch every email draft up front so the Emails page paints
// with data on first render (no client blank→fill).
import { listAllDrafts } from "@/lib/leads/actions";
import EmailsClient from "./EmailsClient";

export default async function EmailsPage() {
  const initialDrafts = await listAllDrafts().catch(() => []);
  return <EmailsClient initialDrafts={initialDrafts} />;
}
