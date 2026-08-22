import { useEffect, useState } from 'react';
import type { ImageSrc } from '../types';
import { blobUrl, cachedUrl } from './idb';

/** Resolve an ImageSrc to something an <img> can use. */
export function useImageUrl(src?: ImageSrc): string | undefined {
  const initial = src ? (src.type === 'remote' ? src.url : cachedUrl(src.key)) : undefined;
  const [url, setUrl] = useState<string | undefined>(initial);

  useEffect(() => {
    let alive = true;
    if (!src) {
      setUrl(undefined);
      return;
    }
    if (src.type === 'remote') {
      setUrl(src.url);
      return;
    }
    const cached = cachedUrl(src.key);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(undefined);
    blobUrl(src.key).then((resolved) => {
      if (alive) setUrl(resolved);
    });
    return () => {
      alive = false;
    };
  }, [src?.type, src && src.type === 'remote' ? src.url : src?.key]);

  return url;
}
