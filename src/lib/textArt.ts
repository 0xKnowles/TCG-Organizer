/**
 * Text tiles: a pocket that says something — a set name, a line title, a divider
 * label — rather than holding a card.
 *
 * The text is rendered to a picture at print resolution and stored like any
 * other art, so placement, PNG export and true-size printing need to know
 * nothing about it. The words and the styling are kept on the item too, so a
 * typo can be fixed without starting again.
 */

import type { TextSpec } from '../types';

export type { TextSpec };

export const FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'sans', label: 'Sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", Times, serif' },
  { id: 'mono', label: 'Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
];

export const DEFAULT_TEXT: TextSpec = {
  text: '',
  fontId: 'sans',
  weight: 700,
  colour: '#f4f4f2',
  background: '#16161a',
  align: 'center',
  padding: 12,
  rule: false,
  rotate: 0,
};

export function fontStack(id: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).stack;
}

/** Pixels along the long edge. 63 mm at this width is a little over 300 dpi. */
const LONG_EDGE = 1100;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (ctx.measureText(next).width <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The largest size that still fits, found by bisection. Auto-fitting beats a
 * size control: the tile is a fixed piece of paper, so the only thing anyone
 * actually wants is the words as large as they will go.
 */
function fit(ctx: CanvasRenderingContext2D, spec: TextSpec, boxW: number, boxH: number) {
  const stack = fontStack(spec.fontId);
  let low = 8;
  let high = Math.floor(boxH);
  let best = { size: low, lines: [spec.text] };
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    ctx.font = `${spec.weight} ${size}px ${stack}`;
    const lines = wrap(ctx, spec.text, boxW);
    const height = lines.length * size * 1.18;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 0);
    if (height <= boxH && widest <= boxW) {
      best = { size, lines };
      low = size + 1;
    } else {
      high = size - 1;
    }
  }
  ctx.font = `${spec.weight} ${best.size}px ${stack}`;
  return best;
}

/** Render a text tile at print resolution. `aspect` is the tile's width / height. */
export function renderText(spec: TextSpec, aspect: number): string {
  const turned = spec.rotate !== 0;
  // A turned tile is drawn on its side, then rotated into place.
  const drawAspect = turned ? 1 / aspect : aspect;
  const W = Math.round(drawAspect >= 1 ? LONG_EDGE : LONG_EDGE * drawAspect);
  const H = Math.round(drawAspect >= 1 ? LONG_EDGE / drawAspect : LONG_EDGE);

  const canvas = document.createElement('canvas');
  canvas.width = turned ? H : W;
  canvas.height = turned ? W : H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not give up a canvas to work on.');

  if (turned) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(((spec.rotate === 90 ? 90 : -90) * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
  }

  if (spec.background) {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = (Math.min(W, H) * spec.padding) / 100;
  if (spec.rule) {
    ctx.strokeStyle = spec.colour;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.006);
    const inset = pad / 2;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    ctx.globalAlpha = 1;
  }

  const boxW = W - pad * 2;
  const boxH = H - pad * 2;
  const { size, lines } = fit(ctx, spec, boxW, boxH);

  ctx.fillStyle = spec.colour;
  ctx.textBaseline = 'middle';
  ctx.textAlign = spec.align === 'center' ? 'center' : spec.align === 'right' ? 'right' : 'left';
  const x = spec.align === 'center' ? W / 2 : spec.align === 'right' ? W - pad : pad;
  const lineHeight = size * 1.18;
  const top = H / 2 - (lines.length * lineHeight) / 2 + lineHeight / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight));

  return canvas.toDataURL('image/png');
}
