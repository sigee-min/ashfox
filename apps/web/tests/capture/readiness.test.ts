import assert from 'node:assert/strict';

import type {
  ProjectSceneProjection
} from '@ashfox/render-core/sceneTypes';
import {
  waitForProjectionTextures
} from '@ashfox/render-core/captureSurface';

const projection = (
  readiness: ProjectSceneProjection['readiness'],
  ready: Promise<void>
): ProjectSceneProjection => ({
  documentReference: {},
  root: null as never,
  objectsByNodeId: new Map(),
  selectable: [],
  readiness,
  ready,
  dispose: () => undefined
});

export const test = (async (): Promise<void> => {
  await waitForProjectionTextures(
    projection(
      { status: 'ready', error: null },
      Promise.resolve()
    ),
    new AbortController().signal
  );

  await assert.rejects(
    waitForProjectionTextures(
      projection(
        {
          status: 'failed',
          error: 'Texture "broken" could not be decoded.'
        },
        Promise.resolve()
      ),
      new AbortController().signal
    ),
    /could not be decoded/
  );

  const pending = new AbortController();
  const waiting = waitForProjectionTextures(
    projection(
      { status: 'pending', error: null },
      new Promise(() => undefined)
    ),
    pending.signal
  );
  pending.abort();
  await assert.rejects(
    waiting,
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === 'AbortError'
  );

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    waitForProjectionTextures(
      projection(
        { status: 'ready', error: null },
        Promise.resolve()
      ),
      alreadyAborted.signal
    ),
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === 'AbortError' &&
      error.message === 'Capture cancelled.',
    'an already-cancelled replay must not pass through a ready projection'
  );

  const readyRaceAbort = new AbortController();
  const readyRace = waitForProjectionTextures(
    projection(
      { status: 'ready', error: null },
      Promise.resolve()
    ),
    readyRaceAbort.signal
  );
  readyRaceAbort.abort();
  await assert.rejects(
    readyRace,
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === 'AbortError',
    'cancellation in the readiness handoff must deterministically win'
  );
})();
