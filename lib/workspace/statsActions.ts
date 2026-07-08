"use server";
// Client-facing wrappers for the server-only workspace reads.
import { getWorkspaceStats as _stats, listActivity as _activity, type WorkspaceStats, type ActivityItem } from "./stats";

export async function getWorkspaceStats(): Promise<WorkspaceStats> { return _stats(); }
export async function listActivity(limit?: number): Promise<ActivityItem[]> { return _activity(limit); }
