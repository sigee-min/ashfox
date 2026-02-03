import type { TextureSource } from '../../ports/editor';
import type { DomPort } from '../../ports/dom';
import type { ToolResponse } from '../../types';
import { err } from '../response';
import { TEXTURE_BASE_IMAGE_UNAVAILABLE, TEXTURE_BASE_SIZE_UNAVAILABLE } from '../../shared/messages';

const IMAGE_LOAD_TIMEOUT_MS = 3000;

export const resolveTextureBase = async (
  dom: DomPort,
  source: TextureSource
): Promise<ToolResponse<{ image: CanvasImageSource; width: number; height: number }>> => {
  let image = source.image ?? null;
  if (image && isHtmlImage(image)) {
    const ready = await ensureImageReady(image, IMAGE_LOAD_TIMEOUT_MS);
    if (!ready) {
      image = null;
    }
  }
  if (!image) {
    image = await loadImageFromDataUri(dom, source.dataUri);
  }
  if (!image) return err('not_implemented', TEXTURE_BASE_IMAGE_UNAVAILABLE);
  const width =
    typeof source.width === 'number' && Number.isFinite(source.width) && source.width > 0
      ? source.width
      : resolveImageDim(image, 'width');
  const height =
    typeof source.height === 'number' && Number.isFinite(source.height) && source.height > 0
      ? source.height
      : resolveImageDim(image, 'height');
  if (!width || !height) return err('invalid_payload', TEXTURE_BASE_SIZE_UNAVAILABLE);
  return { ok: true, data: { image, width, height } };
};

const loadImageFromDataUri = async (dom: DomPort, dataUri?: string): Promise<CanvasImageSource | null> => {
  if (!dataUri) return null;
  const img = dom.createImage();
  if (!img) return null;
  img.src = dataUri;
  const ready = await ensureImageReady(img, IMAGE_LOAD_TIMEOUT_MS);
  return ready ? img : null;
};

const isHtmlImage = (value: CanvasImageSource): value is HTMLImageElement => {
  const candidate = value as { naturalWidth?: unknown; naturalHeight?: unknown };
  return typeof candidate.naturalWidth === 'number' || typeof candidate.naturalHeight === 'number';
};

const ensureImageReady = async (img: HTMLImageElement, timeoutMs: number): Promise<boolean> => {
  if (isImageReady(img)) return true;
  if (typeof img.decode === 'function') {
    try {
      await withTimeout(img.decode(), timeoutMs);
    } catch (err) {
      return waitForImageLoad(img, timeoutMs);
    }
    return isImageReady(img);
  }
  return waitForImageLoad(img, timeoutMs);
};

const isImageReady = (img: HTMLImageElement): boolean => {
  const width = img.naturalWidth ?? img.width ?? 0;
  const height = img.naturalHeight ?? img.height ?? 0;
  return img.complete && width > 0 && height > 0;
};

const waitForImageLoad = (img: HTMLImageElement, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      if (timer) {
        clearTimeout(timer);
      }
    };
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(ok);
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    timer = setTimeout(() => finish(false), timeoutMs);
  });

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });

const resolveImageDim = (image: CanvasImageSource, key: 'width' | 'height'): number => {
  const candidate = image as { width?: unknown; height?: unknown; naturalWidth?: unknown; naturalHeight?: unknown };
  const natural = key === 'width' ? candidate.naturalWidth : candidate.naturalHeight;
  const value = natural ?? candidate[key] ?? 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};
