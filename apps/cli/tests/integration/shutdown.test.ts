import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { chromeShutdown } from '../../src/observe/shutdown';

const main = async (): Promise<void> => {
  const child = new ChildProcess();
  const signals: (NodeJS.Signals | number | undefined)[] = [];
  child.kill = signal => { signals.push(signal); return true; };
  let requests = 0;
  const stop = chromeShutdown(child, () => { requests++; }, 10);
  const pending = stop();
  assert.equal(stop(), pending);
  let finished = false;
  void pending.then(() => { finished = true; });
  child.emit('exit', 0, null);
  await Promise.resolve();
  assert.equal(finished, false, 'profile cleanup must wait for close, not exit');
  child.emit('close', 0, null);
  await pending;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(requests, 1);
  assert.deepEqual(signals, [], 'graceful close cancels escalation');

  const stuck = new ChildProcess();
  const escalations: (NodeJS.Signals | number | undefined)[] = [];
  stuck.kill = signal => {
    escalations.push(signal);
    if (signal === 'SIGKILL') stuck.emit('close', null, signal);
    return true;
  };
  await chromeShutdown(stuck, () => {}, 5)();
  assert.deepEqual(escalations, ['SIGTERM', 'SIGKILL']);

  const exited = new ChildProcess();
  const alreadyClosed = chromeShutdown(exited, () => { throw new Error('must not write to closed process'); });
  exited.emit('close', 0, null);
  await alreadyClosed();
  console.log('Chrome shutdown waits for pipe closure and bounds forced termination');
};
void main().catch(error => { console.error(error); process.exitCode = 1; });
