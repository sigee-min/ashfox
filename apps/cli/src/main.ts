import { isMainThread, parentPort } from 'node:worker_threads';
import { startPoolWorker } from '@ashfox/asset-build';
import { dispatchCliCommand } from './commands/registry';
import { handleCliFailure } from './diagnostics';
import { executeWorker, isPoolWorker } from './workerEntry';

const controller = new AbortController();
const cancel = (): void => controller.abort();

process.stdout.on('error', (error) => {
  if ('code' in error && error.code === 'EPIPE') {
    controller.abort();
    process.exitCode = 130;
  }
});

if (isMainThread) {
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';
  void dispatchCliCommand({
    command,
    args,
    executable: __filename,
    signal: controller.signal,
  })
    .catch((error) => handleCliFailure(command, args, error))
    .finally(() => {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    });
} else if (isPoolWorker()) {
  startPoolWorker();
} else {
  parentPort!.on('message', (message) => {
    if (message === 'cancel') controller.abort();
  });
  void executeWorker(controller.signal);
}
