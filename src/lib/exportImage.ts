import type { Binder, ImageSrc, Placement } from '../types';
import { PAGE_PAD, gapRatio, pocketWidth, placementsOnPage, layoutPlacement } from './geometry';
import { cardAspect, printMetrics } from './pockets';
import { blobUrl } from './idb';

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

/** Draw one piece of a placement: the image is fitted to the whole box, then clipped. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  p: Placement,
  frame: { x: number; y: number; w: number; h: number },
  box: { x: number; y: number; w: number; h: number },
  radius: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, radius);
  ctx.clip();
  const scale =
    p.fit === 'cover'
      ? Math.max(box.w / img.width, box.h / img.height)
      : Math.min(box.w / img.width, box.h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = box.x + (box.w - dw) * (p.fit === 'cover' ? p.focusX / 100 : 0.5);
  const dy = box.y + (box.h - dh) * (p.fit === 'cover' ? p.focusY / 100 : 0.5);
  if (p.rotation) {
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Render one or two pages to a PNG, using the same piece geometry as the screen
 * so a welded seam hides its strip of art and a facing pair stays continuous.
 * Remote art is requested with CORS; if a host refuses, that card is skipped
 * rather than poisoning the whole export.
 */
export async function renderPagesToPng(binder: Binder, pages: (number | null)[], slotWidth = 420): Promise<Blob> {
  const ratio = gapRatio(binder);
  const pocket = pocketWidth(binder.cols, ratio);
  const pageW = slotWidth / pocket;
  const pad = PAGE_PAD * pageW;
  const gap = slotWidth * ratio;
  const slotH = slotWidth / cardAspect(binder);
  const pageH = 2 * pad + binder.rows * slotH + (binder.rows - 1) * gap;
  const metrics = printMetrics(binder);
  const mmToPx = slotWidth / metrics.cardW;
  const gutter = pages.length > 1 ? metrics.spine * mmToPx : 0;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pageW * pages.length + gutter);
  canvas.height = Math.round(pageH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  ctx.fillStyle = '#111110';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const originOf = (index: number) => index * (pageW + gutter);
  const slotXY = (pageIndex: number, col: number, row: number) => ({
    x: originOf(pageIndex) + pad + col * (slotWidth + gap),
    y: pad + row * (slotH + gap),
  });
  const radius = slotWidth * 0.03;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    ctx.fillStyle = '#1c1c1b';
    ctx.fillRect(originOf(i), 0, pageW, pageH);
    if (page === null) continue;

    ctx.fillStyle = '#262624';
    for (let row = 0; row < binder.rows; row++) {
      for (let col = 0; col < binder.cols; col++) {
        const { x, y } = slotXY(i, col, row);
        ctx.beginPath();
        ctx.roundRect(x, y, slotWidth, slotH, radius);
        ctx.fill();
      }
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page === null) continue;

    for (const placement of placementsOnPage(binder, page)) {
      const item = binder.library.find((it) => it.id === placement.itemId);
      if (!item) continue;
      const url = await resolve(item.image);
      if (!url) continue;
      const laid = layoutPlacement(binder, placement, { ...metrics, gap: metrics.gap, spine: metrics.spine });
      let img: HTMLImageElement;
      try {
        img = await loadImage(url);
      } catch {
        continue; // a host that refuses CORS is skipped, not fatal
      }

      // Cards you do not own yet show as ghosts, the way they do on screen.
      ctx.globalAlpha = item.owned === false ? 0.26 : 1;
      for (const piece of laid.pieces) {
        if (piece.page !== page) continue;
        const anchor = slotXY(i, piece.col, piece.row);
        const frame = {
          x: anchor.x,
          y: anchor.y,
          w: piece.spanCols * slotWidth + (piece.spanCols - 1) * gap,
          h: piece.spanRows * slotH + (piece.spanRows - 1) * gap,
        };
        // The image box, positioned so this piece shows its own part of it.
        const box = {
          x: anchor.x - piece.x * mmToPx,
          y: anchor.y - piece.y * mmToPx,
          w: laid.boxW * mmToPx,
          h: laid.boxH * mmToPx,
        };
        drawPiece(ctx, img, placement, frame, box, radius);
      }
      ctx.globalAlpha = 1;
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
  });
}
