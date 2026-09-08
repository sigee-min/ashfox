import type { ProjectDocument } from '@ashfox/engine-core';

import { openWorkspaceSource } from '../files/workspace';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  frameCaptureObject,
  renderCaptureSurface,
  requiredCaptureForward,
  waitForProjectionTextures
} from './captureSurface';
import {
  GIF_CAPTURE_HEIGHT,
  GIF_CAPTURE_WIDTH
} from './gifCaptureSurface';
import { createCaptureProjection } from './projection';
import { renderBuildGif } from './renderBuildGif';

const WORKSPACE_URL = '/tooling/shared-creatures.ashfoxworkspace';
const ENTRY_SELECTORS = [
  { packageName: 'workbench', entryName: 'griffin' },
  { packageName: 'creatures', entryName: 'fox' },
  { packageName: 'creatures', entryName: 'goblin' }
] as const;

const blobBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const canvasPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')),
    'image/png'
  ));

const renderPoster = async (document: ProjectDocument): Promise<Blob> => {
  const surface = createCaptureSurface({
    width: GIF_CAPTURE_WIDTH,
    height: GIF_CAPTURE_HEIGHT,
    environment: 'studio',
    cameraMode: 'perspective',
    forward: requiredCaptureForward(document)
  });
  const projection = createCaptureProjection(document, {});
  surface.scene.add(projection.root);
  try {
    frameCaptureObject(surface, 'perspective', projection.root);
    await waitForProjectionTextures(
      projection,
      new AbortController().signal
    );
    renderCaptureSurface(surface);
    return await canvasPng(surface.renderCanvas);
  } finally {
    surface.scene.remove(projection.root);
    projection.dispose();
    disposeCaptureSurface(surface);
  }
};

const downloadLink = (
  label: string,
  name: string,
  blob: Blob
): HTMLAnchorElement => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.textContent = label;
  link.style.color = '#f3ead8';
  link.style.fontWeight = '700';
  return link;
};

const byteFields = async (
  entryName: string,
  kind: 'gif' | 'png',
  blob: Blob
): Promise<HTMLSpanElement> => {
  const container = document.createElement('span');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = 'position:fixed;left:-10000px;width:1px;height:1px;opacity:0';
  const encoded = await blobBase64(blob);
  const chunkSize = 48 * 1024;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const field = document.createElement('span');
    field.dataset.showcaseBytes = `${entryName}-${kind}`;
    field.dataset.part = String(offset / chunkSize);
    field.dataset.chunk = encoded.slice(offset, offset + chunkSize);
    container.append(field);
  }
  return container;
};

const toolPanel = (): HTMLElement => {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Showcase capture tool');
  panel.style.cssText = [
    'position:fixed', 'z-index:1000', 'inset:24px 24px auto auto',
    'width:min(420px,calc(100vw - 48px))', 'padding:20px',
    'border:1px solid #c78b42', 'border-radius:14px',
    'background:#111417f2', 'box-shadow:0 24px 80px #0009',
    'color:#f3ead8', 'font:14px/1.5 Inter,sans-serif'
  ].join(';');
  panel.innerHTML = `
    <strong style="display:block;font-size:18px">Showcase capture</strong>
    <p style="margin:6px 0 16px;color:#b8b0a1">
      Local development tool · canonical workspace · studio perspective
    </p>
  `;
  return panel;
};

/** Installs the local-only bridge used to seal checked-in showcase replays. */
export const installShowcaseCapture = (target: Window): void => {
  const panel = toolPanel();
  const status = document.createElement('p');
  status.setAttribute('aria-live', 'polite');
  status.style.color = '#edae61';
  panel.append(status);
  target.document.body.append(panel);

  void fetch(WORKSPACE_URL).then(async (response) => {
    if (!response.ok) throw new Error('Canonical showcase workspace is unavailable.');
    const source = await response.text();
    const renders: Array<() => Promise<void>> = [];
    for (const { packageName, entryName } of ENTRY_SELECTORS) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px;align-items:center;margin-top:10px';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Render ${entryName}`;
      button.style.cssText = [
        'padding:9px 14px', 'border:0', 'border-radius:8px',
        'background:#c78b42', 'color:#111417', 'font-weight:800',
        'cursor:pointer'
      ].join(';');
      row.append(button);
      panel.append(row);
      const render = async (): Promise<void> => {
        button.disabled = true;
        status.textContent = `Rendering ${entryName}…`;
        try {
          const project = openWorkspaceSource(
            source,
            {
              id: `showcase-${entryName}`,
              revision: 'showcase-v1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            },
            { packageName, entryName }
          );
          const capture = await renderBuildGif({
            document: project.document,
            assets: {},
            environment: 'studio',
            cameraMode: 'perspective',
            signal: new AbortController().signal
          });
          const replayBytes = new Uint8Array(capture.bytes.byteLength);
          replayBytes.set(capture.bytes);
          const replay = new Blob([replayBytes.buffer], { type: 'image/gif' });
          const poster = await renderPoster(project.document);
          row.append(
            downloadLink(
              'Replay GIF',
              `${entryName}-build-replay.gif`,
              replay
            ),
            downloadLink('Poster PNG', `${entryName}-poster.png`, poster),
            await byteFields(entryName, 'gif', replay),
            await byteFields(entryName, 'png', poster)
          );
          button.remove();
          status.textContent = `${entryName} ready · ${capture.frameCount} frames`;
        } catch (error) {
          button.disabled = false;
          status.textContent = error instanceof Error
            ? error.message
            : `${entryName} capture failed.`;
          throw error;
        }
      };
      renders.push(render);
      button.addEventListener('click', () => void render().catch(() => undefined));
    }
    if (new URLSearchParams(target.location.search).get('capture') === 'all') {
      for (const render of renders) await render();
      target.document.documentElement.dataset.showcaseCapture = 'ready';
    }
  }).catch((error: unknown) => {
    status.textContent = error instanceof Error
      ? error.message
      : 'Showcase capture setup failed.';
  });
};
