"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { css, Box, Btn } from "@/components/primitives";
import { chip } from "@/lib/visuals";
import {
  listProducts, addProduct, deleteProduct, setProductFolder, importProductsCsv,
  listFolders, addFolder, deleteFolder,
} from "@/lib/products/actions";
import type { ProductDTO, FolderDTO } from "@/lib/products/store";

const UNFILED = "__unfiled__"; // virtual folder for products not in any real folder
const INPUT = "border:1px solid #E4E4E7;background:#fff;border-radius:10px;padding:9px 12px;font-size:13px;color:#18181B;outline:none";
const LABEL = "font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px";
const FIELD = "width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:9px 13px;font-size:13px;color:#18181B;outline:none";

export default function ProductsPage() {
  const { showToast } = useApp();
  const [items, setItems] = useState<ProductDTO[]>([]);
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [folder, setFolder] = useState<string | null>(null); // null = All products
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", price: "", description: "" });
  const [folderName, setFolderName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Root + Unfiled both need the full list (Unfiled filters to loose products client-side).
  const targetFolder = folder === UNFILED ? null : folder;
  const refresh = useCallback(async () => {
    setLoading(true);
    const [rows, fs] = await Promise.all([listProducts(folder === UNFILED ? null : folder), listFolders()]);
    setItems(rows); setFolders(fs); setLoading(false);
  }, [folder]);
  useEffect(() => { refresh(); }, [refresh]);

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    showToast("Importing…");
    try {
      const res = await importProductsCsv(await file.text(), targetFolder);
      showToast(res.error ? res.error : `Imported ${res.added} product${res.added === 1 ? "" : "s"}`);
    } catch { showToast("Import failed — please try again"); }
    if (fileRef.current) fileRef.current.value = "";
    refresh();
  };

  const submitAdd = async () => {
    if (!form.name.trim()) { showToast("A product name is required"); return; }
    await addProduct({ ...form, folderId: targetFolder });
    setForm({ name: "", category: "", price: "", description: "" });
    setShowAdd(false); showToast("Product added"); refresh();
  };

  const submitFolder = async () => {
    if (!folderName.trim()) { showToast("A folder name is required"); return; }
    const f = await addFolder(folderName);
    setFolderName(""); setShowFolder(false); showToast("Folder created");
    if (f) setFolder(f.id); else refresh();
  };

  const removeFolder = async () => {
    if (!folder || folder === UNFILED) return; // Unfiled is virtual — not deletable
    await deleteFolder(folder);
    showToast("Folder deleted"); setFolder(null);
  };

  const onDelete = async (id: string, name: string) => { await deleteProduct(id); showToast(name + " deleted"); refresh(); };
  const onMove = async (id: string, fid: string) => { await setProductFolder(id, fid || null); refresh(); };

  const isUnfiled = folder === UNFILED;
  const isRealFolder = folder !== null && folder !== UNFILED;
  const inFolderView = folder !== null; // real folder OR Unfiled → show the table
  const activeFolder = folders.find((f) => f.id === folder);
  const crumbName = isUnfiled ? "Unfiled" : activeFolder?.name;
  const rootProducts = items.filter((p) => !p.folderId); // loose products (valid at root + Unfiled)
  const shown = isUnfiled ? rootProducts : items; // real folder → its items; Unfiled → loose

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:16px;animation:fadeUp .3s ease")}>
      {/* toolbar: breadcrumb + actions */}
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        {inFolderView ? (
          <div style={css("display:flex;align-items:center;gap:7px;font-size:13px")}>
            <Box onClick={() => setFolder(null)} style="color:#5122C1;font-weight:600;cursor:pointer" styleHover="text-decoration:underline">← All products</Box>
            <span style={css("color:#D4D4D8")}>/</span>
            <span style={css("font-weight:700")}>{crumbName}</span>
            <span style={css("color:#A1A1AA")}>· {shown.length} product{shown.length === 1 ? "" : "s"}</span>
          </div>
        ) : (
          <div style={css("font-size:13px;color:#71717A")}>{folders.length} folder{folders.length === 1 ? "" : "s"} · your agents’ source of truth</div>
        )}
        <div style={css("margin-left:auto;display:flex;gap:8px;align-items:center")}>
          {isRealFolder && <Btn onClick={removeFolder} style="background:#fff;color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:9px 14px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECEC">Delete folder</Btn>}
          {!inFolderView && <Btn onClick={() => setShowFolder(true)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">New folder</Btn>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Import CSV" onChange={(e) => onCsv(e.target.files?.[0])} style={css("display:none")} />
          <Btn onClick={() => fileRef.current?.click()} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Import CSV</Btn>
          <Btn onClick={() => setShowAdd(true)} style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#3F3F46">+ Add product</Btn>
        </div>
      </div>

      {/* TOP LEVEL: folder tiles only (click a folder to open it) */}
      {!inFolderView && (
        loading ? (
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
        ) : folders.length === 0 && rootProducts.length === 0 ? (
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:44px 18px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center")}>
            <div style={css("width:52px;height:52px;border-radius:14px;background:#F1EDFD;display:flex;align-items:center;justify-content:center;font-size:24px")}>📦</div>
            <div style={css("font-size:15px;font-weight:700")}>No products yet</div>
            <div style={css("font-size:12.5px;color:#A1A1AA;max-width:360px")}>Create a folder, import a CSV, or add a product — your agents use this catalog to write proposals and outreach.</div>
          </div>
        ) : (
          <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px")}>
            {folders.map((f) => (
              <Box key={f.id} onClick={() => setFolder(f.id)} style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px;cursor:pointer;transition:transform .12s,box-shadow .12s" styleHover="transform:translateY(-2px);box-shadow:0 8px 20px rgba(24,24,27,.08)">
                <div style={css("width:38px;height:38px;border-radius:10px;background:#F1EDFD;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none")}>📁</div>
                <div style={css("min-width:0")}>
                  <div style={css("font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{f.name}</div>
                  <div style={css("font-size:11.5px;color:#A1A1AA")}>{f.count} item{f.count === 1 ? "" : "s"}</div>
                </div>
              </Box>
            ))}
            {rootProducts.length > 0 && (
              <Box onClick={() => setFolder(UNFILED)} style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px;cursor:pointer;transition:transform .12s,box-shadow .12s" styleHover="transform:translateY(-2px);box-shadow:0 8px 20px rgba(24,24,27,.08)">
                <div style={css("width:38px;height:38px;border-radius:10px;background:#F4F4F5;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none")}>🗂</div>
                <div style={css("min-width:0")}>
                  <div style={css("font-size:13.5px;font-weight:700")}>Unfiled</div>
                  <div style={css("font-size:11.5px;color:#A1A1AA")}>{rootProducts.length} item{rootProducts.length === 1 ? "" : "s"}</div>
                </div>
              </Box>
            )}
          </div>
        )
      )}

      {/* FOLDER VIEW: the open folder's (or Unfiled's) products */}
      {inFolderView && (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
          <div style={css("display:grid;grid-template-columns:2fr 1fr .7fr 1.1fr auto;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
            <div>Product</div><div>Category</div><div>Price</div><div>Folder</div><div>Actions</div>
          </div>
          {loading ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
          ) : shown.length === 0 ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>This folder is empty. Use “Import CSV” or “+ Add product”, or move products in from the Folder column.</div>
          ) : shown.map((p) => (
            <div key={p.id} style={css("display:grid;grid-template-columns:2fr 1fr .7fr 1.1fr auto;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
              <div style={css("font-weight:600;min-width:0")}>{p.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.description || "No description"}</div>
                {Object.keys(p.attributes || {}).length > 0 && (
                  <div style={css("display:flex;gap:5px;flex-wrap:wrap;margin-top:5px")}>
                    {Object.entries(p.attributes).slice(0, 4).map(([k, v]) => (
                      <span key={k} style={css("font-size:10px;font-weight:500;color:#52525B;background:#F4F4F5;border-radius:6px;padding:2px 7px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}><span style={css("color:#A1A1AA")}>{k}:</span> {v}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>{p.category ? <span style={css(chip("#F1EDFD", "#5122C1"))}>{p.category}</span> : <span style={css("color:#A1A1AA")}>—</span>}</div>
              <div style={css("font-weight:600;color:#3F3F46")}>{p.price || "—"}</div>
              <div>
                <select value={p.folderId ?? ""} onChange={(e) => onMove(p.id, e.target.value)} style={css(INPUT + ";cursor:pointer;padding:6px 9px;font-size:12px;max-width:100%")}>
                  <option value="">No folder</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <Btn onClick={() => onDelete(p.id, p.name)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#B91C1C" styleHover="background:#FEECEC">Delete</Btn>
            </div>
          ))}
        </div>
      )}

      {/* new-folder modal */}
      {showFolder && (
        <div onClick={() => setShowFolder(false)} style={css("position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease")}>
          <div onClick={(e) => e.stopPropagation()} style={css("background:#fff;border-radius:18px;width:100%;max-width:420px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)")}>
            <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3")}>
              <div style={css("font-size:15px;font-weight:700")}>New folder</div>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Group products (e.g. Subscriptions, Services).</div>
            </div>
            <div style={css("padding:18px 20px")}>
              <div style={css(LABEL)}>Folder name</div>
              <input autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitFolder(); }} placeholder="e.g. Subscriptions" style={css(FIELD)} />
            </div>
            <div style={css("padding:14px 20px;border-top:1px solid #F0F0F3;display:flex;justify-content:flex-end;gap:8px")}>
              <Btn onClick={() => setShowFolder(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
              <Btn onClick={submitFolder} style={"color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;background:#5122C1;" + (folderName.trim() ? "cursor:pointer" : "opacity:.5;cursor:default")} styleHover={folderName.trim() ? "background:#42199E" : ""}>Create folder</Btn>
            </div>
          </div>
        </div>
      )}

      {/* add-product modal */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={css("position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease")}>
          <div onClick={(e) => e.stopPropagation()} style={css("background:#fff;border-radius:18px;width:100%;max-width:460px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)")}>
            <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3")}>
              <div style={css("font-size:15px;font-weight:700")}>Add a product</div>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Add an offering your agents can reference{activeFolder ? " · " + activeFolder.name : ""}.</div>
            </div>
            <div style={css("padding:18px 20px;display:flex;flex-direction:column;gap:14px")}>
              <div>
                <div style={css(LABEL)}>Name</div>
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="e.g. Pro Plan" style={css(FIELD)} />
              </div>
              <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
                <div>
                  <div style={css(LABEL)}>Category</div>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="e.g. Subscription" style={css(FIELD)} />
                </div>
                <div>
                  <div style={css(LABEL)}>Price</div>
                  <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="e.g. $99/mo" style={css(FIELD)} />
                </div>
              </div>
              <div>
                <div style={css(LABEL)}>Description</div>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="What it is / who it's for" style={css(FIELD)} />
              </div>
            </div>
            <div style={css("padding:14px 20px;border-top:1px solid #F0F0F3;display:flex;justify-content:flex-end;gap:8px")}>
              <Btn onClick={() => setShowAdd(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
              <Btn onClick={submitAdd} style={"color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;background:#5122C1;" + (form.name.trim() ? "cursor:pointer" : "opacity:.5;cursor:default")} styleHover={form.name.trim() ? "background:#42199E" : ""}>Add product</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
