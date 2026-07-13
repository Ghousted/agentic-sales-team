// Server component: fetch the booked meetings up front so the calendar paints
// with data on first render (no client blank→fill).
import { listMeetings } from "@/lib/meetings/actions";
import CalendarClient from "./CalendarClient";

export default async function CalendarPage() {
  const initialEvents = await listMeetings().catch(() => []);
  return <CalendarClient initialEvents={initialEvents} />;
}
