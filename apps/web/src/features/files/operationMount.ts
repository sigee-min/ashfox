/** Each effect setup restores liveness, including StrictMode's cleanup/setup
 * replay. Cleanup detaches the active work before abort callbacks can run. */
export const mountFileOperation = <T extends { controller: AbortController }>(
  mounted: { current: boolean },
  active: { current: T | null }
): (() => void) => {
  mounted.current = true;
  return () => {
    mounted.current = false;
    const operation = active.current;
    active.current = null;
    operation?.controller.abort();
  };
};
