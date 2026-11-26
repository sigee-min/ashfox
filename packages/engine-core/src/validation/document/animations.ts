import {
  closedRecord,
  expectArray,
  expectBoolean,
  expectFiniteNumber,
  expectLiteral,
  expectString,
  expectStringArray,
  hasOwn,
  reject,
  validateRecordMap,
  type ContractContext,
} from './shared';

const validateMolang = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(value, path, ['kind', 'source'], [], context);
  if (!record) return;
  expectLiteral(record.kind, ['molang'], `${path}.kind`, context);
  expectString(record.source, `${path}.source`, context);
};

const validateAnimationScalar = (value: unknown, path: string, context: ContractContext): void => {
  if (typeof value === 'number') {
    expectFiniteNumber(value, path, context);
    return;
  }
  validateMolang(value, path, context);
};

const validateAnimationVec3 = (value: unknown, path: string, context: ContractContext): void => {
  const values = expectArray(value, path, context);
  if (!values) return;
  if (values.length !== 3) {
    reject(context, path, `${path} must contain exactly 3 components.`);
  }
  values.forEach((entry, index) => {
    validateAnimationScalar(entry, `${path}[${index}]`, context);
  });
};

const validateEasing = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(value, path, ['type'], ['arguments'], context);
  if (!record) return;
  expectString(record.type, `${path}.type`, context);
  if (hasOwn(record, 'arguments')) {
    const values = expectArray(record.arguments, `${path}.arguments`, context);
    values?.forEach((entry, index) => {
      validateAnimationScalar(entry, `${path}.arguments[${index}]`, context);
    });
  }
};

const validateTransformKey = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['id', 'timeSeconds', 'value', 'interpolation'],
    ['quaternion', 'preValue', 'postValue', 'easing'],
    context,
  );
  if (!record) return;
  expectString(record.id, `${path}.id`, context);
  expectFiniteNumber(record.timeSeconds, `${path}.timeSeconds`, context);
  validateAnimationVec3(record.value, `${path}.value`, context);
  if (hasOwn(record, 'quaternion')) {
    const q = expectArray(record.quaternion, `${path}.quaternion`, context);
    if (q && q.length !== 4)
      reject(context, `${path}.quaternion`, `${path}.quaternion must have 4 numbers.`);
    q?.forEach((entry, index) =>
      expectFiniteNumber(entry, `${path}.quaternion[${index}]`, context),
    );
  }
  expectLiteral(
    record.interpolation,
    ['linear', 'step', 'catmullrom'],
    `${path}.interpolation`,
    context,
  );
  if (hasOwn(record, 'preValue')) {
    validateAnimationVec3(record.preValue, `${path}.preValue`, context);
  }
  if (hasOwn(record, 'postValue')) {
    validateAnimationVec3(record.postValue, `${path}.postValue`, context);
  }
  if (hasOwn(record, 'easing')) {
    validateEasing(record.easing, `${path}.easing`, context);
  }
};

const validateChannel = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['id', 'targetNodeId', 'property', 'keys'],
    ['rotationSpace'],
    context,
  );
  if (!record) return;
  expectString(record.id, `${path}.id`, context);
  expectString(record.targetNodeId, `${path}.targetNodeId`, context);
  expectLiteral(record.property, ['position', 'rotation', 'scale'], `${path}.property`, context);
  if (hasOwn(record, 'rotationSpace')) {
    expectLiteral(record.rotationSpace, ['bone', 'entity'], `${path}.rotationSpace`, context);
  }
  const keys = expectArray(record.keys, `${path}.keys`, context);
  keys?.forEach((entry, index) => {
    validateTransformKey(entry, `${path}.keys[${index}]`, context);
  });
};

const validateAnimationEffect = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['effect'],
    ['locatorId', 'preEffectScript', 'bindToActor'],
    context,
  );
  if (!record) return;
  expectString(record.effect, `${path}.effect`, context);
  if (hasOwn(record, 'locatorId')) {
    expectString(record.locatorId, `${path}.locatorId`, context);
  }
  if (hasOwn(record, 'preEffectScript')) {
    validateMolang(record.preEffectScript, `${path}.preEffectScript`, context);
  }
  if (hasOwn(record, 'bindToActor')) {
    expectBoolean(record.bindToActor, `${path}.bindToActor`, context);
  }
};

const validateEffectValue = (value: unknown, path: string, context: ContractContext): void => {
  if (Array.isArray(value)) {
    const values = expectArray(value, path, context);
    values?.forEach((entry, index) => {
      validateAnimationEffect(entry, `${path}[${index}]`, context);
    });
    return;
  }
  validateAnimationEffect(value, path, context);
};

const validateTriggerTrack = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(value, path, ['id', 'type', 'keys'], [], context);
  if (!record) return;
  expectString(record.id, `${path}.id`, context);
  const typeValid = expectLiteral(
    record.type,
    ['sound', 'particle', 'timeline'],
    `${path}.type`,
    context,
  );
  const keys = expectArray(record.keys, `${path}.keys`, context);
  keys?.forEach((entry, index) => {
    const keyPath = `${path}.keys[${index}]`;
    const key = closedRecord(entry, keyPath, ['id', 'timeSeconds', 'value'], [], context);
    if (!key) return;
    expectString(key.id, `${keyPath}.id`, context);
    expectFiniteNumber(key.timeSeconds, `${keyPath}.timeSeconds`, context);
    if (!typeValid) return;
    if (record.type === 'timeline') {
      if (typeof key.value === 'string') return;
      expectStringArray(key.value, `${keyPath}.value`, context);
      return;
    }
    validateEffectValue(key.value, `${keyPath}.value`, context);
  });
};

const validateCue = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['kind', 'time', 'name'],
    ['endTime', 'anchor', 'payload'],
    context,
  );
  if (!record) return;
  expectLiteral(record.kind, ['sound', 'vfx', 'event'], `${path}.kind`, context);
  expectFiniteNumber(record.time, `${path}.time`, context);
  expectString(record.name, `${path}.name`, context);
  if (hasOwn(record, 'endTime')) expectFiniteNumber(record.endTime, `${path}.endTime`, context);
  if (hasOwn(record, 'anchor')) expectString(record.anchor, `${path}.anchor`, context);
  if (hasOwn(record, 'payload')) {
    validateRecordMap(record.payload, `${path}.payload`, context, (entry, entryPath) => {
      if (typeof entry !== 'string' && typeof entry !== 'boolean') {
        expectFiniteNumber(entry, entryPath, context);
      }
    });
  }
};

const validateAnimationClip = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['id', 'name', 'durationSeconds', 'fps', 'loop', 'channels', 'triggers'],
    [
      'startDelay',
      'loopDelay',
      'animationTimeUpdate',
      'blendWeight',
      'overridePreviousAnimation',
      'cues',
    ],
    context,
  );
  if (!record) return;
  expectString(record.id, `${path}.id`, context);
  expectString(record.name, `${path}.name`, context);
  expectFiniteNumber(record.durationSeconds, `${path}.durationSeconds`, context);
  expectFiniteNumber(record.fps, `${path}.fps`, context);
  expectLiteral(record.loop, ['once', 'loop', 'hold_on_last_frame'], `${path}.loop`, context);
  for (const key of ['startDelay', 'loopDelay', 'animationTimeUpdate'] as const) {
    if (hasOwn(record, key)) {
      validateMolang(record[key], `${path}.${key}`, context);
    }
  }
  if (hasOwn(record, 'blendWeight')) {
    validateAnimationScalar(record.blendWeight, `${path}.blendWeight`, context);
  }
  if (hasOwn(record, 'overridePreviousAnimation')) {
    expectBoolean(record.overridePreviousAnimation, `${path}.overridePreviousAnimation`, context);
  }
  validateRecordMap(record.channels, `${path}.channels`, context, (entry, entryPath) =>
    validateChannel(entry, entryPath, context),
  );
  validateRecordMap(record.triggers, `${path}.triggers`, context, (entry, entryPath) =>
    validateTriggerTrack(entry, entryPath, context),
  );
  if (hasOwn(record, 'cues')) {
    const cues = expectArray(record.cues, `${path}.cues`, context);
    cues?.forEach((entry, index) => validateCue(entry, `${path}.cues[${index}]`, context));
  }
};

export const validateAnimations = (value: unknown, context: ContractContext): void => {
  validateRecordMap(value, 'animations', context, (entry, path) => {
    validateAnimationClip(entry, path, context);
  });
};
