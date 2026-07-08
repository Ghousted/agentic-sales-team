"use server";
// Client-facing wrappers for the products catalog (session-scoped).
import { getSession } from "@/lib/auth/session";
import {
  listProducts as _list, addProduct as _add, deleteProduct as _del, importProductsCsv as _import, setProductFolder as _move,
  listFolders as _folders, addFolder as _addFolder, deleteFolder as _delFolder,
  type ProductDTO, type ProductInput, type FolderDTO,
} from "./store";

async function uid(): Promise<string | null> { return (await getSession())?.userId ?? null; }

export async function listProducts(folderId?: string | null): Promise<ProductDTO[]> { const u = await uid(); return u ? _list(u, folderId) : []; }
export async function addProduct(input: ProductInput): Promise<ProductDTO | null> { const u = await uid(); return u ? _add(u, input) : null; }
export async function deleteProduct(id: string): Promise<void> { const u = await uid(); if (u) await _del(u, id); }
export async function setProductFolder(id: string, folderId: string | null): Promise<void> { const u = await uid(); if (u) await _move(u, id, folderId); }
export async function importProductsCsv(csvText: string, folderId?: string | null): Promise<{ added: number; error?: string }> { const u = await uid(); return u ? _import(u, csvText, folderId) : { added: 0, error: "Not signed in." }; }

export async function listFolders(): Promise<FolderDTO[]> { const u = await uid(); return u ? _folders(u) : []; }
export async function addFolder(name: string): Promise<FolderDTO | null> { const u = await uid(); return u ? _addFolder(u, name) : null; }
export async function deleteFolder(id: string): Promise<void> { const u = await uid(); if (u) await _delFolder(u, id); }
