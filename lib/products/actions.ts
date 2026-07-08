"use server";
// Client-facing wrappers for the products catalog (session-scoped).
import { getSession } from "@/lib/auth/session";
import { listProducts as _list, addProduct as _add, deleteProduct as _del, importProductsCsv as _import, type ProductDTO, type ProductInput } from "./store";

async function uid(): Promise<string | null> { return (await getSession())?.userId ?? null; }

export async function listProducts(): Promise<ProductDTO[]> { const u = await uid(); return u ? _list(u) : []; }
export async function addProduct(input: ProductInput): Promise<ProductDTO | null> { const u = await uid(); return u ? _add(u, input) : null; }
export async function deleteProduct(id: string): Promise<void> { const u = await uid(); if (u) await _del(u, id); }
export async function importProductsCsv(csvText: string): Promise<{ added: number; error?: string }> { const u = await uid(); return u ? _import(u, csvText) : { added: 0, error: "Not signed in." }; }
