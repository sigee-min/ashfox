export const captureAbortError = (): DOMException =>
  new DOMException('Capture cancelled.', 'AbortError');

export const throwIfCaptureAborted = (
  signal: AbortSignal
): void => {
  if (signal.aborted) throw captureAbortError();
};

export const yieldCaptureFrame = (
  signal: AbortSignal
): Promise<void> => new Promise((resolve, reject) => {
  throwIfCaptureAborted(signal);
  let settled = false;
  const finish = (result: 'frame' | 'abort'): void => {
    if (settled) return;
    settled = true;
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(timeoutId);
    signal.removeEventListener('abort', abort);
    if (result === 'abort') reject(captureAbortError());
    else resolve();
  };
  const abort = (): void => finish('abort');
  const frameId = window.requestAnimationFrame(() => finish('frame'));
  const timeoutId = window.setTimeout(() => finish('frame'), 50);
  signal.addEventListener('abort', abort, { once: true });
});
