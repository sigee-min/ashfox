import type { DomPort } from '../../ports/dom';

import { readGlobals } from './blockbenchUtils';

export class BlockbenchDom implements DomPort {
  createCanvas(): HTMLCanvasElement | null {
    const doc = readGlobals().document ?? null;
    if (!doc || typeof doc.createElement !== 'function') return null;
    return (doc.createElement('canvas') as HTMLCanvasElement) ?? null;
  }

  createImage(): HTMLImageElement | null {
    const doc = readGlobals().document ?? null;
    if (!doc || typeof doc.createElement !== 'function') return null;
    return (doc.createElement('img') as HTMLImageElement) ?? null;
  }
}


