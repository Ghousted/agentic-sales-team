"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { css, Box, Btn } from "@/components/primitives";
import { chip } from "@/lib/visuals";
import { listProducts, addProduct, deleteProduct, importProductsCsv } from "@/lib/products/actions";
import type { ProductDTO } from "@/lib/products/store";

const LABEL = "font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px";
const FIELD = "width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:9px 13px;font-size:13px;color:#18181B;outline:none";

export default function ProductsPage() {
  const { showToast } = useApp();
  const [items, setItems] = useState<ProductDTO[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", price: "", description: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listProducts().then(setItems);
  useEffect(() => { refresh(); }, []);

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    showToast("Importing…");
    try {
      const res = await importProductsCsv(await file.text());
      showToast(res.error ? res.error : `Imported ${res.added} product${res.added === 1 ? "" : "s"}`);
    } catch { showToast("Import failed — please try again"); }
    if (fileRef.current) fileRef.current.value = "";
    refresh();
  };

  const submitAdd = async () => {
    if (!form.name.trim()) { showToast("A product name is required"); return; }
    await addProduct(form);
    setForm({ name: "", category: "", price: "", description: "" });
    setShowAdd(false);
    showToast("Product added");
    refresh();
  };

  const onDelete = async (id: string, name: string) => { await deleteProduct(id); showToast(name + " deleted"); refresh(); };

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:16px;animation:fadeUp .3s ease")}>
      {/* toolbar */}
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <div style={css("font-size:13px;color:#71717A")}>{items.length} product{items.length === 1 ? "" : "s"} in your catalog · your agents’ source of truth</div>
        <div style={css("margin-left:auto;display:flex;gap:8px;align-items:center")}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Import CSV" onChange={(e) => onCsv(e.target.files?.[0])} style={css("display:none")} />
          <Btn onClick={() => fileRef.current?.click()} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Import CSV</Btn>
          <Btn onClick={() => setShowAdd(true)} style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#3F3F46">+ Add product</Btn>
        </div>
      </div>

      {/* catalog table */}
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(24,24,27,.04)")}>
        <div style={css("display:grid;grid-template-columns:2.2fr 1fr .8fr auto;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
          <div>Product</div><div>Category</div><div>Price</div><div></div>
        </div>
        {items.length === 0 ? (
          <div style={css("padding:40px 18px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center")}>
            <div style={css("width:44px;height:44px;border-radius:12px;background:#F1EDFD;display:flex;align-items:center;justify-content:center;font-size:22px")}>📦</div>
            <div style={css("font-size:13px;font-weight:600;color:#3F3F46")}>No products yet</div>
            <div style={css("font-size:12px;color:#A1A1AA;max-width:340px")}>Import a CSV (columns: <b>name</b>, description, price, category) or add one manually — your agents use this to write proposals and outreach.</div>
          </div>
        ) : items.map((p) => (
          <div key={p.id} style={css("display:grid;grid-template-columns:2.2fr 1fr .8fr auto;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
            <div style={css("display:flex;align-items:center;gap:11px;min-width:0")}>
              <div style={css("width:34px;height:34px;border-radius:10px;background:#F1EDFD;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none")}>📦</div>
              <div style={css("min-width:0")}>
                <div style={css("font-weight:600")}>{p.name}</div>
                <div style={css("font-size:11px;color:#A1A1AA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.description || "No description"}</div>
              </div>
            </div>
            <div>{p.category ? <span style={css(chip("#F1EDFD", "#5122C1"))}>{p.category}</span> : <span style={css("color:#A1A1AA")}>—</span>}</div>
            <div style={css("font-weight:600;color:#3F3F46")}>{p.price || "—"}</div>
            <Btn onClick={() => onDelete(p.id, p.name)} style="background:#fff;color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECEC">Delete</Btn>
          </div>
        ))}
      </div>

      {/* add-product modal */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={css("position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease")}>
          <div onClick={(e) => e.stopPropagation()} style={css("background:#fff;border-radius:18px;width:100%;max-width:460px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)")}>
            <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3")}>
              <div style={css("font-size:15px;font-weight:700")}>Add a product</div>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Add an offering your agents can reference.</div>
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
