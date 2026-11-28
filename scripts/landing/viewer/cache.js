import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MAX_CACHE_ENTRIES = 6;
const bufferCache = new Map();
const inflightFetches = new Map();
const sharedLoader = new GLTFLoader();

const touchLru = (key, value) => {
  if (bufferCache.has(key)) bufferCache.delete(key);
  bufferCache.set(key, value);
  while (bufferCache.size > MAX_CACHE_ENTRIES) {
    const oldest = bufferCache.keys().next().value;
    bufferCache.delete(oldest);
  }
};

const readWithProgress = async (response, onProgress) => {
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || total <= 0) {
    onProgress?.(0.5);
    const buffer = await response.arrayBuffer();
    onProgress?.(1);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(Math.min(0.95, loaded / total));
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(1);
  return merged.buffer;
};

const resolveResourcePath = (src) => {
  try {
    const url = new URL(src, window.location.href);
    return url.href.slice(0, url.href.lastIndexOf('/') + 1);
  } catch {
    return '';
  }
};

const fetchGlbBuffer = async (src, { onProgress, signal } = {}) => {
  const cached = bufferCache.get(src);
  if (cached) {
    touchLru(src, cached);
    onProgress?.(1);
    return cached;
  }

  let promise = inflightFetches.get(src);
  if (!promise) {
    promise = (async () => {
      const response = await fetch(src, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch GLB (${response.status}): ${src}`);
      }
      const buffer = await readWithProgress(response, onProgress);
      touchLru(src, buffer);
      return buffer;
    })().finally(() => {
      inflightFetches.delete(src);
    });
    inflightFetches.set(src, promise);
  } else {
    onProgress?.(0.25);
  }

  const buffer = await promise;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(1);
  return buffer;
};

export const loadGlbFromCache = async (src, { onProgress, signal } = {}) => {
  const buffer = await fetchGlbBuffer(src, { onProgress, signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return sharedLoader.parseAsync(buffer.slice(0), resolveResourcePath(src));
};

export const clearGlbCache = () => {
  bufferCache.clear();
};
