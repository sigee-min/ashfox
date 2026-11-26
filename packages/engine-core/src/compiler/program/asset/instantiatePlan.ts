import { compareText } from '../../../stableOrder';
import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import {
  type AssetSymbolId,
  type TypedAssetAssembly,
  type TypedAssetHir,
  type TypedMotion,
  type TypedMotionTrack,
  type TypedPoseKey,
  type TypedRigContract,
  type TypedSkeleton,
  type TypedWaveBinding,
} from './contract';
import { AssetBudgetAbort } from './budgets';
import { composeAssetFrames, connectAssetFrames, type AssetExactFrame } from './frame';
import {
  type AssetBudgetDimension,
  type AssetBudgetLedger,
  type InstantiatedComponentInstance,
  type InstantiatedMotion,
  type InstantiatedMotionChannel,
  type InstantiatedMotionKey,
  type InstantiatedMotionLayer,
  type InstantiatedPose,
  type InstantiatedPoseEntry,
  type InstantiatedPoseKey,
  type InstantiatedSocketConnection,
  type InstantiatedSocketEndpoint,
  type InstantiatedSurfaceBinding,
  type InstantiatedWaveBinding,
} from './ir';
import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetVectorValue,
} from './value/contract';

export const INSTANTIATION_LIMITS: Readonly<Record<AssetBudgetDimension, number>> = freeze({
  instances: 1024,
  bones: 4096,
  nodes: 16384,
  faces: 65536,
  motionKeys: 65536,
  diagnostics: 256,
});

export class InstantiationLedger {
  private readonly values = new Map<AssetBudgetDimension, number>();
  constructor(
    private readonly issue: (path: string, span: SourceSpan, code: string, message: string) => void,
  ) {}
  use(dimension: AssetBudgetDimension, path: string, span: SourceSpan): void {
    const next = (this.values.get(dimension) ?? 0) + 1;
    this.values.set(dimension, next);
    if (next > INSTANTIATION_LIMITS[dimension]) {
      this.issue(
        path,
        span,
        'asset.instantiation-limit',
        `Asset instantiation exceeds the ${dimension} budget.`,
      );
      throw new AssetBudgetAbort();
    }
  }
  note(dimension: AssetBudgetDimension): void {
    this.values.set(dimension, (this.values.get(dimension) ?? 0) + 1);
  }
  snapshot(): AssetBudgetLedger {
    const used = Object.create(null) as Record<AssetBudgetDimension, number>;
    for (const key of Object.keys(INSTANTIATION_LIMITS) as AssetBudgetDimension[]) {
      used[key] = this.values.get(key) ?? 0;
    }
    return freeze({ limits: INSTANTIATION_LIMITS, used: freeze(used) });
  }
}

export interface InstantiationSession {
  readonly hir: TypedAssetHir;
  readonly diagnostics: AssetDiagnostic[];
  readonly ledger: InstantiationLedger;
  readonly nodeIds: Set<string>;
  readonly pathFor: (symbol: AssetSymbolId) => string;
  readonly issue: (path: string, span: SourceSpan, code: string, message: string) => void;
}

const endpoint = (
  instance: InstantiatedComponentInstance,
  port: string,
): InstantiatedSocketEndpoint | null =>
  instance.socketEndpoints.find((item) => item.port === port) ?? null;

interface ProviderPlacement {
  readonly providerWorld: AssetExactFrame;
  readonly providerLocal: AssetExactFrame;
  readonly parentBoneId: string;
}

const resolveProviderPlacement = (
  connection: TypedAssetAssembly['connections'][number],
  byId: ReadonlyMap<string, InstantiatedComponentInstance>,
  rig: TypedRigContract,
  skeletonWorld: ReadonlyMap<string, AssetExactFrame>,
  placements: ReadonlyMap<string, AssetExactFrame>,
  placed: ReadonlySet<string>,
): ProviderPlacement | null => {
  if (connection.fromInstance === 'skeleton') {
    const socket = rig.sockets[connection.fromPort];
    const jointWorld = socket === undefined ? undefined : skeletonWorld.get(socket.joint);
    if (socket === undefined || jointWorld === undefined) return null;
    const providerWorld = composeAssetFrames(jointWorld, socket.frame);
    return providerWorld === null
      ? null
      : { providerWorld, providerLocal: socket.frame, parentBoneId: socket.joint };
  }
  const provider = byId.get(connection.fromInstance);
  const provided = provider === undefined ? null : endpoint(provider, connection.fromPort);
  const placement = provider === undefined ? undefined : placements.get(provider.id);
  const semanticWorld = provided === null ? undefined : skeletonWorld.get(provided.geometryBoneId);
  const ownerWorld = semanticWorld ?? placement;
  if (provided === null || ownerWorld === undefined || !placed.has(provider!.id)) return null;
  const providerWorld = composeAssetFrames(ownerWorld, provided.frame);
  return providerWorld === null
    ? null
    : { providerWorld, providerLocal: provided.frame, parentBoneId: provided.geometryBoneId };
};

const tryPlaceConnection = (
  session: InstantiationSession,
  connection: TypedAssetAssembly['connections'][number],
  byId: ReadonlyMap<string, InstantiatedComponentInstance>,
  rig: TypedRigContract,
  skeletonWorld: ReadonlyMap<string, AssetExactFrame>,
  placements: Map<string, AssetExactFrame>,
  placed: Set<string>,
  connections: InstantiatedSocketConnection[],
): boolean => {
  const target = byId.get(connection.toInstance);
  const required = target === undefined ? null : endpoint(target, connection.toPort);
  const provider = resolveProviderPlacement(
    connection,
    byId,
    rig,
    skeletonWorld,
    placements,
    placed,
  );
  if (provider === null || required === null) return false;
  const parentPlacement = connectAssetFrames(provider.providerLocal, required.frame);
  const placement = connectAssetFrames(provider.providerWorld, required.frame);
  if (parentPlacement === null || placement === null) {
    session.issue(
      target!.sourcePath,
      connection.span,
      'asset.connection-frame',
      'Socket connection frames cannot be composed exactly.',
    );
    return true;
  }
  placements.set(target!.id, placement);
  placed.add(target!.id);
  connections.push(
    freeze({
      id: `${connection.fromInstance}.${connection.fromPort}->${connection.toInstance}.${connection.toPort}`,
      fromInstance: connection.fromInstance,
      fromPort: connection.fromPort,
      toInstance: connection.toInstance,
      toPort: connection.toPort,
      targetBoneId: required.geometryBoneId,
      parentBoneId: provider.parentBoneId,
      parentPlacement,
      span: connection.span,
    }),
  );
  return true;
};

export const placeConnections = (
  session: InstantiationSession,
  asset: TypedAssetAssembly,
  instances: readonly InstantiatedComponentInstance[],
  skeletonWorld: ReadonlyMap<string, AssetExactFrame>,
): Readonly<{
  readonly instances: readonly InstantiatedComponentInstance[];
  readonly connections: readonly InstantiatedSocketConnection[];
}> => {
  const skeleton = session.hir.skeletons[asset.skeleton.key]!;
  const rig = session.hir.rigs[skeleton.rig.key]!;
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  const placements = new Map(
    instances
      .filter((instance) => instance.placementAuthority === 'rig')
      .map((instance) => [instance.id, instance.placement]),
  );
  const placed = new Set(placements.keys());
  const pending = [...asset.connections];
  const connections: InstantiatedSocketConnection[] = [];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (
        tryPlaceConnection(
          session,
          pending[index]!,
          byId,
          rig,
          skeletonWorld,
          placements,
          placed,
          connections,
        )
      ) {
        pending.splice(index, 1);
        progressed = true;
      }
    }
  }
  for (const connection of pending) {
    session.issue(
      session.pathFor(asset.symbol),
      connection.span,
      'asset.connection-order',
      'Socket connection cannot resolve a provider placement.',
    );
  }
  const placedInstances = instances.map((instance) =>
    freeze({ ...instance, placement: placements.get(instance.id) ?? instance.placement }),
  );
  connections.sort((left, right) => compareText(left.id, right.id));
  return freeze({ instances: freeze(placedInstances), connections: freeze(connections) });
};

const axisDot = (left: readonly number[], right: readonly number[]): -1 | 0 | 1 =>
  (left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!) as -1 | 0 | 1;

const mapMotionVector = (
  rig: TypedRigContract,
  skeleton: TypedSkeleton,
  source: AssetVectorValue,
  target: string,
  property: InstantiatedMotionChannel['property'],
): AssetVectorValue | null => {
  const semantic = rig.joints[target]?.frame;
  const concrete = skeleton.binds[target];
  if (semantic === undefined || concrete === undefined) return null;
  const semanticAxes = [semantic.xAxis, semantic.yAxis, semantic.zAxis];
  const concreteAxes = [concrete.xAxis, concrete.yAxis, concrete.zAxis];
  try {
    const values = concreteAxes.map((targetAxis) => {
      const sourceIndex = semanticAxes.findIndex(
        (sourceAxis) => axisDot(targetAxis, sourceAxis) !== 0,
      );
      const coefficient = axisDot(targetAxis, semanticAxes[sourceIndex]!);
      const input = source.values[sourceIndex]!.value;
      return assetNumberValue(
        assetExactNumber(
          input.numerator * BigInt(property === 'scale' ? Math.abs(coefficient) : coefficient),
          input.denominator,
          input.unit,
        ),
      );
    });
    return assetVectorValue(values, source.type);
  } catch {
    return null;
  }
};

const lowerTrackList = (
  session: InstantiationSession,
  rig: TypedRigContract,
  skeleton: TypedSkeleton,
  motionSymbol: AssetSymbolId,
  path: string,
  tracks: readonly TypedMotionTrack[],
): readonly InstantiatedMotionChannel[] =>
  freeze(
    tracks.map((track) => {
      const keys: InstantiatedMotionKey[] = track.keyframes.flatMap((key) => {
        session.ledger.use('motionKeys', path, key.span);
        const value = mapMotionVector(rig, skeleton, key.value, track.target, track.property);
        if (value === null) {
          session.issue(
            path,
            key.span,
            'asset.motion-frame-map',
            `Motion key cannot map semantic joint "${track.target}" into its skeleton frame.`,
          );
          return [];
        }
        return [
          freeze({
            time: key.time,
            value,
            interpolation: key.interpolation,
            curve: key.curve,
            span: key.span,
          }),
        ];
      });
      return freeze({
        id: `${motionSymbol.name}:${track.target}:${track.property}`,
        targetBoneId: track.target,
        property: track.property,
        keys: freeze(keys),
        span: track.span,
      });
    }),
  );

const mapWaveAxis = (
  rig: TypedRigContract,
  skeleton: TypedSkeleton,
  wave: TypedWaveBinding,
): { readonly axis: 'x' | 'y' | 'z'; readonly sign: number } => {
  const semantic = rig.joints[wave.target]?.frame;
  const concrete = skeleton.binds[wave.target];
  if (semantic === undefined || concrete === undefined) return { axis: wave.axis, sign: 1 };
  const idx = wave.axis === 'x' ? 0 : wave.axis === 'y' ? 1 : 2;
  const semAxis = [semantic.xAxis, semantic.yAxis, semantic.zAxis][idx]!;
  const conAxes = [concrete.xAxis, concrete.yAxis, concrete.zAxis] as const;
  const targetIdx = conAxes.findIndex((axis) => axisDot(axis, semAxis) !== 0);
  if (targetIdx < 0) return { axis: wave.axis, sign: 1 };
  const coeff = axisDot(conAxes[targetIdx]!, semAxis);
  const axis = targetIdx === 0 ? 'x' : targetIdx === 1 ? 'y' : 'z';
  return { axis, sign: wave.property === 'scale' ? Math.abs(coeff) : coeff };
};

const lowerWaves = (
  rig: TypedRigContract,
  skeleton: TypedSkeleton,
  waves: readonly TypedWaveBinding[],
): readonly InstantiatedWaveBinding[] =>
  freeze(
    waves.map((wave) => {
      const mapped = mapWaveAxis(rig, skeleton, wave);
      return freeze({
        targetBoneId: wave.target,
        property: wave.property,
        axis: mapped.axis,
        spec: wave.spec,
        scale: wave.scale * mapped.sign,
        span: wave.span,
      });
    }),
  );

const lowerPoseKeys = (poseKeys: readonly TypedPoseKey[]): readonly InstantiatedPoseKey[] =>
  freeze(
    poseKeys.map((pk) =>
      freeze({ time: pk.time, poseId: pk.poseId, curve: pk.curve, span: pk.span }),
    ),
  );

const lowerInstantiatedPose = (
  rig: TypedRigContract,
  skeleton: TypedSkeleton,
  pose: TypedMotion['poses'][number],
): InstantiatedPose =>
  freeze({
    id: pose.id,
    entries: freeze(
      pose.entries.flatMap((entry): InstantiatedPoseEntry[] => {
        const mapped = mapMotionVector(rig, skeleton, entry.value, entry.target, entry.property);
        return mapped === null
          ? []
          : [
              freeze({
                targetBoneId: entry.target,
                property: entry.property,
                value: mapped,
                span: entry.span,
              }),
            ];
      }),
    ),
    span: pose.span,
  });

const lowerInstantiatedMotion = (
  session: InstantiationSession,
  rig: TypedRigContract,
  skeleton: TypedSkeleton,
  motion: TypedMotion,
): InstantiatedMotion => {
  const path = session.pathFor(motion.symbol);
  const channels = lowerTrackList(session, rig, skeleton, motion.symbol, path, motion.tracks);
  const layers: InstantiatedMotionLayer[] = motion.layers.map((layer) =>
    freeze({
      id: layer.id,
      mode: layer.mode,
      weight: layer.weight,
      mask: layer.mask,
      mirrorMode: layer.mirrorMode,
      gait: layer.gait,
      channels: lowerTrackList(session, rig, skeleton, motion.symbol, path, layer.tracks),
      waves: lowerWaves(rig, skeleton, layer.waves),
      poseKeys: lowerPoseKeys(layer.poseKeys),
      span: layer.span,
    }),
  );
  return freeze({
    symbol: motion.symbol,
    sourcePath: path,
    duration: motion.duration,
    fps: motion.fps,
    loop: motion.loop,
    restRelative: motion.restRelative,
    channels,
    layers: freeze(layers),
    waves: lowerWaves(rig, skeleton, motion.waves),
    poses: freeze(motion.poses.map((p) => lowerInstantiatedPose(rig, skeleton, p))),
    poseKeys: lowerPoseKeys(motion.poseKeys),
    iks: motion.iks,
    secondaries: motion.secondaries,
    combat: motion.combat,
    cues: motion.cues,
    span: motion.span,
  });
};

export const buildMotions = (
  session: InstantiationSession,
  asset: TypedAssetAssembly,
): readonly InstantiatedMotion[] => {
  const skeleton = session.hir.skeletons[asset.skeleton.key]!;
  const rig = session.hir.rigs[skeleton.rig.key]!;
  return asset.motions.flatMap((symbol) => {
    const motion = session.hir.motions[symbol.key];
    return motion === undefined ? [] : [lowerInstantiatedMotion(session, rig, skeleton, motion)];
  });
};

export const collectSelectedSurfaces = (
  hir: TypedAssetHir,
  asset: TypedAssetAssembly,
): readonly InstantiatedSurfaceBinding[] => {
  const selectedSurfaces = new Map<string, InstantiatedSurfaceBinding>();
  for (const use of asset.uses) {
    for (const symbol of Object.values(use.portBindings)) {
      const surface = hir.surfaces[symbol.key];
      const contract =
        surface === undefined ? undefined : hir.surfaceContracts[surface.contract.key];
      if (surface === undefined || contract === undefined || selectedSurfaces.has(symbol.key))
        continue;
      selectedSurfaces.set(
        symbol.key,
        freeze({
          surface: symbol,
          contract: contract.symbol,
          material: surface.material,
          charts: freeze(Object.keys(contract.charts).sort(compareText)),
          span: surface.span,
        }),
      );
    }
  }
  return freeze(
    [...selectedSurfaces.values()].sort((left, right) =>
      compareText(left.surface.key, right.surface.key),
    ),
  );
};
