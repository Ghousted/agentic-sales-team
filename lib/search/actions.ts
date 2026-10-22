"use server";
// Client-facing wrapper for global search (session-scoped).
import { getSession } from "@/lib/auth/session";
import { searchRecords as _search, type SearchResults } from "./store";

export async function searchRecords(query: string): Promise<SearchResults> {
  const u = (await getSession())?.userId;
  return u ? _search(u, query) : { leads: [], products: [] };
}
