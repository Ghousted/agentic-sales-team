"use server";
import { getSession } from "@/lib/auth/session";
import { listProposalsForAgent as _list, markProposalSent as _sent, type ProposalDTO } from "./store";

async function uid(): Promise<string | null> { return (await getSession())?.userId ?? null; }

export async function listProposalsForAgent(agentId: string): Promise<ProposalDTO[]> { const u = await uid(); return u ? _list(u, agentId) : []; }
export async function markProposalSent(id: string): Promise<void> { const u = await uid(); if (u) await _sent(u, id); }
