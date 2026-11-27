import type { SourceSpan } from '../../source/contract';
import type { ProgramExpr } from '../syntax/contract';
import type {
  AssetAnchorDecl,
  AssetBindDecl,
  AssetChainDecl,
  AssetFrameDecl,
  AssetIkLimbDecl,
  AssetJointDecl,
  AssetJointLimitsDecl,
  AssetMotionChannel,
  AssetPropertyDecl,
  AssetQualifiedName,
  AssetRigContractDecl,
  AssetSkeletonDecl,
  AssetSocketContractDecl,
  AssetSocketDecl,
} from './contract';
import {
  checkClosedProperties,
  frameOrNull,
  isOneOf,
  join,
  nameOr,
  propertyValue,
  qualifiedFromName,
  readBraced,
  readProperty,
  readUniqueFrame,
  valueName,
  type AssetReader,
} from './parserSupport';

const optionalTarget = (
  value: ProgramExpr | undefined,
  fallbackSpan: SourceSpan,
): AssetQualifiedName | null => {
  const name = nameOr(value, 'none');
  if (name === null || name === 'none') return null;
  return qualifiedFromName(name, value?.span ?? fallbackSpan);
};

const readJointChannels = (
  reader: AssetReader,
  channelValue: ProgramExpr | undefined,
  span: SourceSpan,
): readonly AssetMotionChannel[] => {
  if (channelValue === undefined) {
    reader.failSpan(
      'asset.missing-joint-channels',
      'Every rig joint requires an explicit allowed channel set.',
      span,
    );
    return Object.freeze([]);
  }
  const raw = channelValue.kind === 'vector' ? channelValue.values : [channelValue];
  const channels: AssetMotionChannel[] = [];
  for (const value of raw) {
    const name = valueName(value);
    if (isOneOf(['position', 'rotation', 'scale'] as const, name)) channels.push(name);
    else {
      reader.failSpan(
        'asset.invalid-joint-channels',
        'Joint channels must name position, rotation, and/or scale.',
        value.span,
      );
    }
  }
  return Object.freeze(channels);
};

const readRangeExpr = (reader: AssetReader): readonly [ProgramExpr, ProgramExpr] => {
  const min = reader.expression();
  reader.expect('..', 'Expected .. in limits range.');
  const max = reader.expression();
  return Object.freeze([min, max] as const);
};

const readJointLimits = (reader: AssetReader): AssetJointLimitsDecl => {
  const start = reader.expectWord('limits', 'Expected limits.');
  let pitch: readonly [ProgramExpr, ProgramExpr] | null = null;
  let yaw: readonly [ProgramExpr, ProgramExpr] | null = null;
  let roll: readonly [ProgramExpr, ProgramExpr] | null = null;
  const close = readBraced(
    reader,
    'Expected { to begin joint limits.',
    'Expected } to close joint limits.',
    () => {
      const axis = reader.id('Expected pitch, yaw, or roll in joint limits.');
      reader.expect('=', 'Expected = in joint limit.');
      const range = readRangeExpr(reader);
      reader.finish();
      if (axis.value === 'pitch') pitch = range;
      else if (axis.value === 'yaw') yaw = range;
      else if (axis.value === 'roll') roll = range;
      else reader.fail('asset.invalid-property', `Unknown joint limit axis "${axis.value}".`, axis);
    },
  );
  return Object.freeze({ kind: 'limits', pitch, yaw, roll, span: join(start.span, close.span) });
};

const readJoint = (reader: AssetReader): AssetJointDecl => {
  const start = reader.expectWord('joint', 'Expected joint.');
  const id = reader.id('Expected a joint name.');
  const values: AssetPropertyDecl[] = [];
  let frame: AssetFrameDecl | null = null;
  let limits: AssetJointLimitsDecl | null = null;
  const close = readBraced(
    reader,
    'Expected { to begin a rig joint.',
    'Expected } to close a rig joint.',
    () => {
      if (reader.checkWord('frame')) frame = readUniqueFrame(reader, frame);
      else if (reader.checkWord('limits')) limits = readJointLimits(reader);
      else if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError('rig contract joint');
    },
  );
  checkClosedProperties(
    reader,
    values,
    ['parent', 'role', 'channels', 'mirror'],
    'rig contract joint',
  );
  const channels = readJointChannels(reader, propertyValue(values, 'channels'), id.span);
  const mirrorValue = propertyValue(values, 'mirror');
  const roleValue = propertyValue(values, 'role');
  return Object.freeze({
    kind: 'joint',
    id: id.value,
    parent: optionalTarget(propertyValue(values, 'parent'), id.span),
    role: roleValue === undefined ? null : valueName(roleValue),
    frame,
    channels,
    mirror: optionalTarget(mirrorValue, id.span),
    limits,
    span: join(start.span, close.span),
  });
};

const readSocket = (reader: AssetReader): AssetSocketDecl => {
  const start = reader.expectWord('socket', 'Expected socket.');
  const id = reader.id('Expected a socket name.');
  reader.expect(':', 'Expected : and a socket contract.');
  const contract = reader.qualified('Expected socket contract name.');
  const values: AssetPropertyDecl[] = [];
  let frame: AssetFrameDecl | null = null;
  const close = readBraced(
    reader,
    'Expected { to begin a socket.',
    'Expected } to close a socket.',
    () => {
      if (reader.checkWord('frame')) frame = readUniqueFrame(reader, frame);
      else if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError('rig contract socket');
    },
  );
  checkClosedProperties(reader, values, ['joint', 'capacity'], 'rig contract socket');
  const jointValue = propertyValue(values, 'joint');
  const jointRaw = jointValue === undefined ? null : valueName(jointValue);
  if (jointRaw === null)
    reader.fail('asset.missing-socket-joint', 'A socket requires a local joint.', id);
  const joint = qualifiedFromName(jointRaw, jointValue?.span ?? id.span);
  const capacityValue = propertyValue(values, 'capacity');
  const capacityRaw = nameOr(capacityValue, '');
  if (capacityValue === undefined) {
    reader.failSpan(
      'asset.missing-socket-capacity',
      'Rig sockets require an explicit capacity = one|many declaration.',
      id.span,
    );
  }
  if (!isOneOf(['one', 'many'] as const, capacityRaw)) {
    reader.fail('asset.invalid-socket-capacity', 'Socket capacity must be one or many.', id);
  }
  return Object.freeze({
    kind: 'socket',
    id: id.value,
    contract,
    joint,
    capacity: capacityRaw === 'many' ? 'many' : 'one',
    frame,
    span: join(start.span, close.span),
  });
};

const readChain = (reader: AssetReader): AssetChainDecl => {
  const start = reader.expectWord('chain', 'Expected chain.');
  const id = reader.id('Expected a chain name.');
  reader.expect('=', 'Expected = after chain name.');
  reader.expect('[', 'Expected [ to begin chain joint list.');
  const joints: AssetQualifiedName[] = [];
  while (!reader.check(']') && !reader.end()) {
    joints.push(reader.qualified('Expected joint name in chain.'));
    if (!reader.match(',')) break;
  }
  const close = reader.expect(']', 'Expected ] to close chain joint list.');
  reader.finish();
  return Object.freeze({
    kind: 'chain',
    id: id.value,
    joints: Object.freeze(joints),
    span: join(start.span, close.span),
  });
};

const readIkChainPair = (
  reader: AssetReader,
  chainExpr: ProgramExpr | undefined,
  span: SourceSpan,
): readonly [AssetQualifiedName, AssetQualifiedName] => {
  if (chainExpr?.kind !== 'vector' || chainExpr.values.length !== 2) {
    reader.failSpan('asset.invalid-ik-chain', 'ik_limb chain must list two joint names.', span);
    return Object.freeze([qualifiedFromName('', span), qualifiedFromName('', span)]);
  }
  const first = qualifiedFromName(valueName(chainExpr.values[0]!), chainExpr.values[0]!.span);
  const second = qualifiedFromName(valueName(chainExpr.values[1]!), chainExpr.values[1]!.span);
  return Object.freeze([first, second]);
};

const readIkLimb = (reader: AssetReader): AssetIkLimbDecl => {
  const start = reader.expectWord('ik_limb', 'Expected ik_limb.');
  const id = reader.id('Expected an ik_limb name.');
  const values: AssetPropertyDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin an ik_limb.',
    'Expected } to close an ik_limb.',
    () => {
      if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError('rig contract ik_limb');
    },
  );
  checkClosedProperties(
    reader,
    values,
    ['chain', 'end_effector', 'pole', 'ground', 'mirror'],
    'rig contract ik_limb',
  );
  const chain = readIkChainPair(reader, propertyValue(values, 'chain'), id.span);
  return Object.freeze({
    kind: 'ik-limb',
    id: id.value,
    chain,
    endEffector: optionalTarget(propertyValue(values, 'end_effector'), id.span),
    pole: propertyValue(values, 'pole') ?? null,
    ground: propertyValue(values, 'ground') ?? null,
    mirror: optionalTarget(propertyValue(values, 'mirror'), id.span),
    span: join(start.span, close.span),
  });
};

const readAnchor = (reader: AssetReader): AssetAnchorDecl => {
  const start = reader.expectWord('anchor', 'Expected anchor.');
  const id = reader.id('Expected an anchor name.');
  const values: AssetPropertyDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin an anchor.',
    'Expected } to close an anchor.',
    () => {
      if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError('rig contract anchor');
    },
  );
  checkClosedProperties(reader, values, ['joint', 'offset'], 'rig contract anchor');
  const jointExpr = propertyValue(values, 'joint');
  const jointName = jointExpr === undefined ? null : valueName(jointExpr);
  if (jointName === null) {
    reader.fail('asset.missing-anchor-joint', 'An anchor requires a local joint.', id);
  }
  return Object.freeze({
    kind: 'anchor',
    id: id.value,
    joint: qualifiedFromName(jointName, jointExpr?.span ?? id.span),
    offset: propertyValue(values, 'offset') ?? null,
    span: join(start.span, close.span),
  });
};

interface RigContractState {
  frame: AssetFrameDecl | null;
  handedness: AssetRigContractDecl['handedness'] | null;
  handednessSeen: boolean;
  readonly joints: AssetJointDecl[];
  readonly sockets: AssetSocketDecl[];
  readonly chains: AssetChainDecl[];
  readonly ikLimbs: AssetIkLimbDecl[];
  readonly anchors: AssetAnchorDecl[];
}

const readRigHandedness = (reader: AssetReader, state: RigContractState): void => {
  const value = readProperty(reader);
  const raw = valueName(value.value);
  if (state.handednessSeen) {
    reader.failSpan(
      'asset.duplicate-handedness',
      'Rig handedness must be declared exactly once.',
      value.span,
    );
  }
  state.handednessSeen = true;
  if (isOneOf(['right', 'left'] as const, raw)) state.handedness = raw;
  else
    reader.failSpan(
      'asset.invalid-handedness',
      'Rig handedness must be right or left.',
      value.value.span,
    );
};

const readRigEntry = (reader: AssetReader, state: RigContractState): void => {
  if (reader.checkWord('frame')) state.frame = readUniqueFrame(reader, state.frame);
  else if (reader.checkWord('handedness')) readRigHandedness(reader, state);
  else if (reader.checkWord('joint')) state.joints.push(readJoint(reader));
  else if (reader.checkWord('socket')) state.sockets.push(readSocket(reader));
  else if (reader.checkWord('chain')) state.chains.push(readChain(reader));
  else if (reader.checkWord('ik_limb')) state.ikLimbs.push(readIkLimb(reader));
  else if (reader.checkWord('anchor')) state.anchors.push(readAnchor(reader));
  else reader.scopeError('rig contract');
};

const readBind = (reader: AssetReader): AssetBindDecl => {
  const start = reader.expectWord('bind', 'Expected bind.');
  const joint = reader.id('Expected a bound joint name.');
  const values: AssetPropertyDecl[] = [];
  let frame: AssetFrameDecl | null = null;
  const close = readBraced(
    reader,
    'Expected { to begin a bind.',
    'Expected } to close a bind.',
    () => {
      if (reader.checkWord('frame')) frame = readUniqueFrame(reader, frame);
      else if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError('skeleton bind');
    },
  );
  const ambiguous = propertyValue(values, 'origin');
  if (ambiguous) {
    reader.failSpan(
      'asset.bind-coordinate-space',
      'Skeleton binds require parent_origin in the parent joint frame; ambiguous origin is not supported.',
      ambiguous.span,
    );
  }
  checkClosedProperties(reader, values, ['parent_origin'], 'skeleton bind');
  return Object.freeze({
    kind: 'bind',
    joint: joint.value,
    parentOrigin: propertyValue(values, 'parent_origin') ?? null,
    frame: frame ?? frameOrNull(values, start.span),
    span: join(start.span, close.span),
  });
};

export const parseSocketContract = (
  reader: AssetReader,
  exported: boolean,
): AssetSocketContractDecl => {
  const start = reader.expectWord('contract', 'Expected contract after socket.');
  const id = reader.id('Expected a socket contract name.');
  const values: AssetPropertyDecl[] = [];
  let frame: AssetFrameDecl | null = null;
  const close = readBraced(
    reader,
    'Expected { to begin a socket contract.',
    'Expected } to close a socket contract.',
    () => {
      if (reader.checkWord('frame')) frame = readUniqueFrame(reader, frame);
      else if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError('socket contract');
    },
  );
  checkClosedProperties(reader, values, ['handedness'], 'socket contract');
  const handednessValue = propertyValue(values, 'handedness');
  const handedness = nameOr(handednessValue, 'right');
  if (!isOneOf(['right', 'left'] as const, handedness)) {
    reader.fail('asset.invalid-handedness', 'Socket handedness must be right or left.', id);
  }
  return Object.freeze({
    kind: 'socket-contract',
    exported,
    id: id.value,
    handedness: handedness === 'left' ? 'left' : 'right',
    frame,
    span: join(start.span, close.span),
  });
};

export const parseRigContract = (reader: AssetReader, exported: boolean): AssetRigContractDecl => {
  const start = reader.expectWord('contract', 'Expected contract after rig.');
  const id = reader.id('Expected a rig contract name.');
  const state: RigContractState = {
    frame: null,
    handedness: null,
    handednessSeen: false,
    joints: [],
    sockets: [],
    chains: [],
    ikLimbs: [],
    anchors: [],
  };
  const close = readBraced(
    reader,
    'Expected { to begin a rig contract.',
    'Expected } to close a rig contract.',
    () => readRigEntry(reader, state),
  );
  return Object.freeze({
    kind: 'rig-contract',
    exported,
    id: id.value,
    handedness: state.handedness ?? 'right',
    frame: state.frame,
    joints: Object.freeze(state.joints),
    sockets: Object.freeze(state.sockets),
    chains: Object.freeze(state.chains),
    ikLimbs: Object.freeze(state.ikLimbs),
    anchors: Object.freeze(state.anchors),
    span: join(start.span, close.span),
  });
};

export const parseSkeleton = (reader: AssetReader, exported: boolean): AssetSkeletonDecl => {
  const start = reader.expectWord('skeleton', 'Expected skeleton.');
  const id = reader.id('Expected a skeleton name.');
  reader.expectWord('implements', 'Skeletons require implements <rig-contract>.');
  const implementsName = reader.qualified('Expected rig contract name.');
  const binds: AssetBindDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin a skeleton.',
    'Expected } to close a skeleton.',
    () => {
      if (reader.checkWord('bind')) binds.push(readBind(reader));
      else reader.scopeError('skeleton');
    },
  );
  return Object.freeze({
    kind: 'skeleton',
    exported,
    id: id.value,
    implements: implementsName,
    binds: Object.freeze(binds),
    span: join(start.span, close.span),
  });
};
