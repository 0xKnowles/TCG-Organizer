import type { DragPayload } from '../types';

export const DND_MIME = 'application/x-binder-item';

/** A module-level copy: Safari will not let us read dataTransfer during dragover. */
let active: DragPayload | null = null;

export function startDrag(e: React.DragEvent, payload: DragPayload) {
  active = payload;
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', 'binder-item');
  } catch {
    /* some browsers restrict custom types */
  }
}

export function endDrag() {
  active = null;
}

export function peekDrag(): DragPayload | null {
  return active;
}

export function readDrag(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DND_MIME);
    if (raw) return JSON.parse(raw) as DragPayload;
  } catch {
    /* fall through to the in-memory copy */
  }
  return active;
}
