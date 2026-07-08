"use client";
import { useEffect, useState } from "react";
import { css, Box, Btn } from "@/components/primitives";
import { listProducts, addProduct, deleteProduct, importProductsCsv } from "@/lib/products/actions";
import type { ProductDTO } from "@/lib/products/store";

const inp = "width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:10px 13px;font-size:13px;outline:none";

export default function ProductsPage() {
  const [items, setItems] = useState<ProductDTO[]>([]);
  const [form, setForm] = useState({ name: "", category: "", price: "", description: "" });
  const [note, setNote] = useState("");
  const refresh = () => listProducts().then(setItems);
  useEffect(() => { refresh(); }, []);

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    setNote("Importing…");
    const res = await importProductsCsv(await file.text());
    setNote(res.error ? res.error : `Imported ${res.added} product${res.added === 1 ? "" : "s"}.`);
    refresh();
  };
  const onAdd = async () => {
    if (!form.name.trim()) return;
    await addProduct(form);
    setForm({ name: "", category: "", price: "", description: "" });
    refresh();
  };
  const onDelete = async (id: string) => { await deleteProduct(id); refresh(); };

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:baseline;gap:12px")}>
        <div style={css("font-family:'Poetsen One',sans-serif;font-size:22px")}>Products & Services</div>
        <div style={css("font-size:13px;color:#71717A")}>{items.length} in your catalog — your agents’ source of truth</div>
      </div>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:12px")}>
        <div style={css("font-size:13.5px;font-weight:700")}>Import from CSV</div>
        <div style={css("font-size:12px;color:#71717A")}>Columns: <b>name</b> (required), description, price, category.</div>
        <input type="file" accept=".csv,text/csv" aria-label="Upload CSV" onChange={(e) => onCsv(e.target.files?.[0])} style={css("font-size:12.5px")} />
        {note && <div style={css("font-size:12px;color:#5122C1")}>{note}</div>}
      </div>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:10px")}>
        <div style={css("font-size:13.5px;font-weight:700")}>Add a product</div>
        <div style={css("display:grid;grid-template-columns:1.4fr 1fr .8fr;gap:10px")}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={css(inp)} />
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" style={css(inp)} />
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price" style={css(inp)} />
        </div>
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" style={css(inp)} />
        <Btn onClick={onAdd} style={"align-self:flex-start;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;" + (form.name.trim() ? "cursor:pointer" : "opacity:.5;cursor:default")} styleHover={form.name.trim() ? "background:#42199E" : ""}>Add product</Btn>
      </div>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
        <div style={css("display:grid;grid-template-columns:1.4fr 1fr .8fr 2fr auto;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;gap:10px")}>
          <div>Name</div><div>Category</div><div>Price</div><div>Description</div><div></div>
        </div>
        {items.length === 0 ? (
          <div style={css("padding:18px;font-size:12.5px;color:#A1A1AA")}>No products yet — import a CSV or add one above.</div>
        ) : items.map((p) => (
          <div key={p.id} style={css("display:grid;grid-template-columns:1.4fr 1fr .8fr 2fr auto;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
            <div style={css("font-weight:600")}>{p.name}</div>
            <div style={css("color:#3F3F46")}>{p.category || "—"}</div>
            <div style={css("color:#3F3F46")}>{p.price || "—"}</div>
            <div style={css("color:#71717A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.description || "—"}</div>
            <Btn onClick={() => onDelete(p.id)} style="background:#fff;color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECEC">Delete</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}
