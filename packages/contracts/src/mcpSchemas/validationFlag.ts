const validatedPayloads = new WeakSet<object>();

export const markSchemaValidated = (payload: unknown): void => {
  if (!payload || typeof payload !== 'object') return;
  validatedPayloads.add(payload as object);
};
