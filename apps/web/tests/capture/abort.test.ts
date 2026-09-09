import assert from 'node:assert/strict';

import {
  throwIfCaptureAborted,
  yieldCaptureFrame
} from '@ashfox/render-core/captureAbort';

export const test = (async (): Promise<void> => {
  const immediate = new AbortController();
  immediate.abort();
  assert.throws(
    () => throwIfCaptureAborted(immediate.signal),
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === 'AbortError' &&
      error.message === 'Capture cancelled.'
  );
  await assert.rejects(
    yieldCaptureFrame(immediate.signal),
    (error: unknown) =>
      error instanceof DOMException && error.name === 'AbortError'
  );

  const previousWindow = Object.getOwnPropertyDescriptor(
    globalThis,
    'window'
  );
  const scheduled: {
    frame: FrameRequestCallback | null;
    timeout: (() => void) | null;
  } = { frame: null, timeout: null };
  const cancelledFrames: number[] = [];
  const clearedTimeouts: number[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        scheduled.frame = callback;
        return 17;
      },
      cancelAnimationFrame: (id: number): void => {
        cancelledFrames.push(id);
      },
      setTimeout: (callback: () => void): number => {
        scheduled.timeout = callback;
        return 23;
      },
      clearTimeout: (id: number): void => {
        clearedTimeouts.push(id);
      }
    }
  });

  try {
    const hiddenTab = new AbortController();
    const fallback = yieldCaptureFrame(hiddenTab.signal);
    assert.notEqual(scheduled.frame, null);
    assert.notEqual(scheduled.timeout, null);
    scheduled.timeout?.();
    await fallback;
    assert.deepEqual(cancelledFrames, [17]);
    assert.deepEqual(clearedTimeouts, [23]);

    scheduled.frame = null;
    scheduled.timeout = null;
    cancelledFrames.length = 0;
    clearedTimeouts.length = 0;
    const pending = new AbortController();
    const aborted = yieldCaptureFrame(pending.signal);
    pending.abort();
    await assert.rejects(
      aborted,
      (error: unknown) =>
        error instanceof DOMException && error.name === 'AbortError'
    );
    assert.deepEqual(cancelledFrames, [17]);
    assert.deepEqual(clearedTimeouts, [23]);
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', previousWindow);
    }
  }
})();
