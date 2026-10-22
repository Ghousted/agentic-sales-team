// Tab icon with an unread dot. Draws the app icon on a canvas and adds a red dot,
// then points every icon <link> at the result. With no unread messages, the
// links get their original href back. A failed draw just leaves the plain icon.

const SIZE = 64;
let base: HTMLImageElement | null = null;

function iconLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
}

function restore(links: HTMLLinkElement[]): void {
  for (const l of links) if (l.dataset.plainHref) { l.href = l.dataset.plainHref; delete l.dataset.plainHref; }
}

function loadBase(src: string): Promise<HTMLImageElement> {
  if (base && base.dataset.src === src) return Promise.resolve(base);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.dataset.src = src;
    img.onload = () => { base = img; resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

export async function setFaviconDot(on: boolean): Promise<void> {
  const links = iconLinks();
  if (!links.length) return;
  if (!on) { restore(links); return; }
  const plain = links[0].dataset.plainHref ?? links[0].href;
  try {
    const img = await loadBase(plain);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    // White ring, then the red dot, at the top right.
    ctx.beginPath(); ctx.arc(SIZE - 15, 15, 15, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.beginPath(); ctx.arc(SIZE - 15, 15, 11, 0, Math.PI * 2); ctx.fillStyle = "#ef4444"; ctx.fill();
    const url = canvas.toDataURL("image/png");
    for (const l of iconLinks()) {
      if (!l.dataset.plainHref) l.dataset.plainHref = l.href;
      l.href = url;
    }
  } catch { /* keep the plain icon */ }
}
