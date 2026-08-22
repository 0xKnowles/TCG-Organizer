import type { Binder, ImageSrc, Placement } from '../types';
import { CARD_ASPECT } from './geometry';
import { blobUrl } from './idb';

const GAP = 0.04; // gap between slots, as a fraction of slot width
const PAD = 0.09;
const SPREAD_GUTTER = 0.22;

async function resolve(src: ImageSrc | undefined): Promise<string | undefined> {
  if (!src) return undefined;
  return src.type === 'remote' ? src.url : await blobUrl(src.key);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  p: Placement,
  radius = 0,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  const scale =
    p.fit === 'cover'
      ? Math.max(w / img.width, h / img.height)
      : Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) * (p.fit === 'cover' ? p.focusX / 100 : 0.5);
  const dy = y + (h - dh) * (p.fit === 'cover' ? p.focusY / 100 : 0.5);
  if (p.rotation) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Render one or two pages to a PNG. Remote card art is requested with CORS;
 * if a host refuses, that card is drawn as an empty slot rather than
 * poisoning the whole export.
 */
export async function renderPagesToPng(
  binder: Binder,
  pages: (number | null)[],
  slotWidth = 420,
): Promise<Blob> {
  const slotH = slotWidth / CARD_ASPECT;
  const pageW = binder.cols * slotWidth + (binder.cols - 1) * GAP * slotWidth + 2 * PAD * slotWidth;
  const pageH = binder.rows * slotH + (binder.rows - 1) * GAP * slotWidth + 2 * PAD * slotWidth;
  const gutter = pages.length > 1 ? SPREAD_GUTTER * slotWidth : 0;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pageW * pages.length + gutter);
  canvas.height = Math.round(pageH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  ctx.fillStyle = '#15161c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const originX = i * (pageW + gutter);

    ctx.fillStyle = '#1e2029';
    ctx.fillRect(originX, 0, pageW, pageH);
    if (page === null) continue;

    const slotXY = (col: number, row: number) => ({
      x: originX + PAD * slotWidth + col * (slotWidth + GAP * slotWidth),
      y: PAD * slotWidth + row * (slotH + GAP * slotWidth),
    });

    const radius = slotWidth * 0.03;

    // Empty pockets first.
    ctx.fillStyle = '#2a2d38';
    for (let row = 0; row < binder.rows; row++) {
      for (let col = 0; col < binder.cols; col++) {
        const { x, y } = slotXY(col, row);
        ctx.beginPath();
        ctx.roundRect(x, y, slotWidth, slotH, radius);
        ctx.fill();
      }
    }

    const onPage = binder.placements.filter((p) => p.page === page);
    for (const p of onPage) {
      const item = binder.library.find((it) => it.id === p.itemId);
      if (!item) continue;
      const url = await resolve(item.image);
      if (!url) continue;
      const { x, y } = slotXY(p.col, p.row);
      const w = p.spanCols * slotWidth + (p.spanCols - 1) * GAP * slotWidth;
      const h = p.spanRows * slotH + (p.spanRows - 1) * GAP * slotWidth;
      try {
        const img = await loadImage(url);
        drawCover(ctx, img, x, y, w, h, p, radius);
      } catch {
        /* skip images the browser will not hand us */
      }
    }

    // Pocket seams across multi-slot art, the way a real page divides it.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = Math.max(1, slotWidth * 0.004);
    for (const p of onPage) {
      if (p.spanCols * p.spanRows < 2) continue;
      for (let r = 0; r < p.spanRows; r++) {
        for (let c = 0; c < p.spanCols; c++) {
          const { x, y } = slotXY(p.col + c, p.row + r);
          ctx.beginPath();
          ctx.roundRect(x, y, slotWidth, slotH, radius);
          ctx.stroke();
        }
      }
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
  });
}
