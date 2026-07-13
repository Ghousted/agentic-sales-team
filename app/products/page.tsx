// Server component: fetch the catalog (All view) + folders up front so the
// products grid paints with data on first render.
import { listProducts, listFolders } from "@/lib/products/actions";
import ProductsClient from "./ProductsClient";

export default async function ProductsPage() {
  const [initialProducts, initialFolders] = await Promise.all([
    listProducts(null).catch(() => []),
    listFolders().catch(() => []),
  ]);
  return <ProductsClient initialProducts={initialProducts} initialFolders={initialFolders} />;
}
