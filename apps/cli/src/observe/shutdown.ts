import type { ChildProcess } from 'node:child_process';

/** Track close from spawn: exit alone does not mean Chrome has released its pipes. */
export const chromeShutdown = (child: ChildProcess, requestClose: () => void, graceMs = 2000): (() => Promise<void>) => {
  let ended = false;
  let stopping: Promise<void> | undefined;
  const closed = new Promise<void>(resolve => child.once('close', () => { ended = true; resolve(); }));
  return () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (ended) return;
      const terminate = setTimeout(() => child.kill('SIGTERM'), graceMs);
      const force = setTimeout(() => child.kill('SIGKILL'), graceMs * 2);
      try {
        try { requestClose(); } catch { child.kill('SIGTERM'); }
        await closed;
      } finally { clearTimeout(terminate); clearTimeout(force); }
    })();
    return stopping;
  };
};
