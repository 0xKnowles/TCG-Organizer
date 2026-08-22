import type { Binder, ImageSrc, LibraryItem } from '../types';
import { getBlob, putBlob } from './idb';
import { uid } from './util';

interface BinderFile {
  format: 'binder-studio';
  version: 1;
  binder: Binder;
  /** Locally stored images, inlined so the file is self-contained. */
  images: Record<string, string>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function exportBinder(binder: Binder): Promise<Blob> {
  const images: Record<string, string> = {};
  for (const item of binder.library) {
    const src: ImageSrc | undefined = item.image;
    if (src?.type === 'local' && !images[src.key]) {
      const blob = await getBlob(src.key);
      if (blob) images[src.key] = await blobToDataUrl(blob);
    }
  }
  const file: BinderFile = { format: 'binder-studio', version: 1, binder, images };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function importBinder(text: string): Promise<Binder> {
  const parsed = JSON.parse(text) as Partial<BinderFile> & Partial<Binder>;
  const binder = (parsed as BinderFile).binder ?? (parsed as Binder);
  if (!binder || typeof binder.cols !== 'number' || !Array.isArray(binder.library)) {
    throw new Error('That does not look like a binder file.');
  }
  const images = (parsed as BinderFile).images ?? {};

  // Re-key imported images so they cannot collide with what is already stored.
  const remap = new Map<string, string>();
  for (const [key, dataUrl] of Object.entries(images)) {
    const nextKey = uid('img');
    await putBlob(nextKey, await dataUrlToBlob(dataUrl));
    remap.set(key, nextKey);
  }
  const library: LibraryItem[] = binder.library.map((item) => {
    if (item.image?.type === 'local') {
      const nextKey = remap.get(item.image.key);
      if (nextKey) return { ...item, image: { type: 'local', key: nextKey } } as LibraryItem;
    }
    return item;
  });

  return { ...binder, library, id: binder.id || uid('binder'), updatedAt: Date.now() };
}
