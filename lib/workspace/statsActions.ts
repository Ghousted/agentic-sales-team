"use server";
// Client-facing wrappers for the server-only workspace reads.
import {
  getWorkspaceStats as _stats, listActivity as _activity,
  listNotifications as _notifs, dismissNotification as _dismiss, clearAllNotifications as _clearAll,
  type WorkspaceStats, type ActivityItem, type NotificationItem,
} from "./stats";

export async function getWorkspaceStats(): Promise<WorkspaceStats> { return _stats(); }
export async function listActivity(limit?: number): Promise<ActivityItem[]> { return _activity(limit); }
export async function listNotifications(limit?: number): Promise<NotificationItem[]> { return _notifs(limit); }
export async function dismissNotification(id: string): Promise<void> { return _dismiss(id); }
export async function clearAllNotifications(): Promise<number> { return _clearAll(); }
