import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import { compilePack, type PackEncoder } from '../packs/compile';
import { evaluateSoundQuality, formatSoundGateFailure } from '@ashfox/audio-core';
import {
  compileDirectoryWorkspace,
  encodeCanonicalPng,
  evaluateAssetQuality,
  evaluateGlbPerformance,
  evaluateSpriteQuality,
  exportProductionProjectResolved,
  exportStructureGltfResolved,
  formatDeliveryGateFailure,
  formatSpriteGateFailure,
  hasHooksContent,
  openAssetProject,
  rasterizeTexture,
  type ExportAdapterInput,
  type GlbPerformanceMetrics,
  type HookBindingTarget,
} from '@ashfox/engine-core';
import { generateWorkspaceHookBindings } from './bindings';
import {
  BuildFailure,
  type Artifact,
  type AssetMetadata,
  type CatalogAsset,
  type CompiledBundle,
  type Snapshot,
} from './contract';
import { digest, json } from '../shared/digest';
import { safeRelative } from '../shared/path';

export const checkSnapshot = (snapshot: Snapshot) => {
  const compiled = compileDirectoryWorkspace(snapshot.configuration, snapshot.files);
  if (!compiled.ok) {
    const first = compiled.diagnostics[0];
    throw new BuildFailure(
      first?.code ?? 'workspace.compile',
      first?.message ?? JSON.stringify(compiled.diagnostics),
      1,
      compiled.diagnostics.map((d) => ({ severity: 'error' as const, ...d })),
      first?.hint,
    );
  }
  return compiled;
};
type CheckedWorkspace = ReturnType<typeof checkSnapshot>;
type CompiledProduct = CheckedWorkspace['products'][number];
type ExportTarget = CheckedWorkspace['config']['exports'][number];
type PackConfig = NonNullable<CheckedWorkspace['config']['packs']>[number];
type OpenedProject = Extract<ReturnType<typeof openAssetProject>, { readonly ok: true }>;

const entryKey = (entry: { readonly packageName: string; readonly entryName: string }): string =>
  JSON.stringify([entry.packageName, entry.entryName]);

const assertModelDeliveryGate = (
  targetName: string,
  product: Extract<CompiledProduct, { readonly kind: 'model' }>,
): void => {
  const hasProfile = product.model.profile !== undefined;
  const audit = evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
  if (!hasProfile)
    throw new BuildFailure(
      'quality.profile-required',
      formatDeliveryGateFailure(targetName, false, audit),
      3,
    );
  if (!audit.passed)
    throw new BuildFailure('quality.gate', formatDeliveryGateFailure(targetName, true, audit), 3);
};

const openTargetProject = (
  product: Extract<CompiledProduct, { readonly kind: 'model' }>,
  buildKey: string,
  key: string,
  projects: Map<string, OpenedProject>,
  remaining: Map<string, number>,
): OpenedProject => {
  const cached = projects.get(key);
  if (cached) return cached;
  const opened = openAssetProject({
    workspace: product.workspace,
    entry: product.entry,
    identity: { id: 'cli', revision: buildKey, createdAt: '2000-01-01T00:00:00.000Z' },
  });
  if (!opened.ok) throw new BuildFailure('export.project', JSON.stringify(opened));
  if ((remaining.get(key) ?? 0) > 1) projects.set(key, opened);
  return opened;
};

const modelAdapterForTarget = (target: ExportTarget): ExportAdapterInput => {
  if ('namespace' in target) {
    return { target: target.format, namespace: target.namespace, modelPath: target.modelPath };
  }
  const modelPath = ('modelPath' in target && target.modelPath) || target.name;
  return { target: target.format === 'gltf' ? 'gltf' : 'glb', modelPath };
};

const compileModelFiles = async (
  target: ExportTarget,
  product: Extract<CompiledProduct, { readonly kind: 'model' }>,
  buildKey: string,
  key: string,
  projects: Map<string, OpenedProject>,
  remaining: Map<string, number>,
): Promise<Artifact[]> => {
  assertModelDeliveryGate(target.name, product);
  if (target.format === 'png' || target.format === 'wav' || target.format === 'java_structure') {
    throw new BuildFailure('export.format', target.name);
  }
  const opened = openTargetProject(product, buildKey, key, projects, remaining);
  const document = opened.project.document;
  const textures = new Map(Object.values(document.textures).map((t) => [t.source.key, t]));
  const gltfOptions =
    target.format === 'glb' || target.format === 'gltf'
      ? {
          encoding: target.encoding ?? 'portable',
          ...(hasHooksContent(product.hooks) ? { hooks: product.hooks } : {}),
        }
      : {};
  const bundle = await exportProductionProjectResolved(
    opened.project,
    modelAdapterForTarget(target),
    {
      resolveBlob: async (ref) => {
        const texture = textures.get(ref.key);
        return texture
          ? {
              bytes: encodeCanonicalPng(rasterizeTexture(document, texture)),
              contentType: 'image/png',
            }
          : null;
      },
      ...gltfOptions,
    },
  );
  const files: Artifact[] = bundle.files.map((file) => {
    if (file.kind === 'blob-copy') throw new BuildFailure('export.unresolved', file.path);
    return {
      path: file.path,
      bytes: file.kind === 'binary' ? file.data : encodeUtf8(json(file.data)),
    };
  });
  if (hasHooksContent(product.hooks)) {
    files.push({ path: `${target.name}.hooks.json`, bytes: encodeUtf8(json(product.hooks)) });
  }
  return files;
};

const compileStructureFiles = async (
  target: ExportTarget,
  product: Extract<CompiledProduct, { readonly kind: 'structure' }>,
  buildKey: string,
): Promise<Artifact[]> => {
  if (!product.structure.audit.passed) {
    throw new BuildFailure(
      'quality.gate',
      `Structure "${target.name}" scored ${product.structure.audit.score}/100 (requires >= ${product.structure.audit.threshold}).`,
      3,
    );
  }
  if (target.format === 'java_structure') {
    const out: Artifact[] = [{ path: `${target.name}.nbt`, bytes: product.structure.nbt }];
    if (hasHooksContent(product.structure.hooks)) {
      out.push({
        path: `${target.name}.hooks.json`,
        bytes: encodeUtf8(json(product.structure.hooks)),
      });
    }
    return out;
  }
  if (target.format !== 'glb') throw new BuildFailure('export.format', target.name);
  const bundle = await exportStructureGltfResolved(product.structure, target.name, buildKey, {
    encoding: target.encoding ?? 'portable',
  });
  const artifacts = bundle.files.map((file) => {
    if (file.kind === 'blob-copy') throw new BuildFailure('export.unresolved', file.path);
    return {
      path: file.path,
      bytes: file.kind === 'binary' ? file.data : encodeUtf8(json(file.data)),
    };
  });
  const metaPath = `${target.name}.structure.json`;
  if (!artifacts.some((file) => file.path === metaPath)) {
    artifacts.push({
      path: metaPath,
      bytes: encodeUtf8(json(product.structure.playableMeta)),
    });
  }
  if (hasHooksContent(product.structure.hooks)) {
    artifacts.push({
      path: `${target.name}.hooks.json`,
      bytes: encodeUtf8(json(product.structure.hooks)),
    });
  }
  return artifacts;
};

const buildProductMetadata = (
  product: CompiledProduct,
  performance?: GlbPerformanceMetrics,
): AssetMetadata => {
  if (product.kind === 'sprite')
    return { width: product.sprite.receipt.width, height: product.sprite.receipt.height };
  if (product.kind === 'structure')
    return {
      size: product.structure.grid.size,
      blockCount: product.structure.audit.metrics.blockCount,
      interiorCells: product.structure.audit.metrics.interiorCells,
      zoneCount: product.structure.playableMeta.zones.length,
      lightCount: product.structure.playableMeta.lights.length,
      interactableCount: product.structure.playableMeta.interactables.length,
      ...(performance ? { performance } : {}),
    };
  if (product.kind === 'model')
    return {
      clips: Object.values(product.model.animations).map((clip) => ({
        name: clip.name,
        durationSeconds: clip.durationSeconds,
      })),
      ...(performance ? { performance } : {}),
    };
  if (product.kind === 'vfx')
    return {
      durationSeconds: product.vfx.durationSeconds,
      fps: product.vfx.fps,
      drawCalls: product.vfx.stats.drawCalls,
      triangles: product.vfx.stats.triangles,
      particleCount: product.vfx.stats.particleCount,
    };
  return {
    variants: product.sounds.map((sound) => ({
      id: sound.variant,
      frames: sound.frames,
      sample_rate: sound.sample_rate,
      channels: sound.channels,
      playback: sound.playback,
      peak: sound.peak,
      rms: sound.rms,
      dc: sound.dc,
      seamDelta: sound.seamDelta,
      maxAdjacentDelta: sound.maxAdjacentDelta,
    })),
  };
};

const assertSpriteDeliveryGate = (
  targetName: string,
  product: Extract<CompiledProduct, { readonly kind: 'sprite' }>,
): void => {
  const audit = evaluateSpriteQuality(product.sprite);
  if (!audit.passed)
    throw new BuildFailure('quality.gate', formatSpriteGateFailure(targetName, audit), 3);
};

const assertSoundDeliveryGate = (
  targetName: string,
  product: Extract<CompiledProduct, { readonly kind: 'sound' }>,
): void => {
  const audit = evaluateSoundQuality(product.sounds);
  if (!audit.passed)
    throw new BuildFailure('quality.gate', formatSoundGateFailure(targetName, audit), 3);
};

export const compileVfxFiles = (
  target: ExportTarget,
  product: Extract<CompiledProduct, { readonly kind: 'vfx' }>,
): Artifact[] => {
  if (target.format !== 'glb') throw new BuildFailure('export.format', target.name);
  const files: Artifact[] = [
    { path: `${target.name}.glb`, bytes: product.glb },
    { path: `${target.name}.vfx.json`, bytes: encodeUtf8(json(product.spec)) },
    { path: `${target.name}.flipbook.json`, bytes: encodeUtf8(json(product.vfx.flipbookManifest)) },
  ];
  if (product.particles.length === 1) {
    files.push({
      path: `${target.name}.particle.json`,
      bytes: encodeUtf8(json(product.particles[0]!)),
    });
  } else {
    product.particles.forEach((p, idx) => {
      files.push({
        path: `${target.name}.${idx}.particle.json`,
        bytes: encodeUtf8(json(p)),
      });
    });
  }
  return files;
};

const compileExportFiles = async (
  target: ExportTarget,
  product: CompiledProduct,
  buildKey: string,
  key: string,
  projects: Map<string, OpenedProject>,
  remaining: Map<string, number>,
): Promise<Artifact[]> => {
  if (product.kind === 'sprite') {
    assertSpriteDeliveryGate(target.name, product);
    const out: Artifact[] = [{ path: `${target.name}.png`, bytes: product.sprite.png }];
    if (hasHooksContent(product.hooks)) {
      out.push({ path: `${target.name}.hooks.json`, bytes: encodeUtf8(json(product.hooks)) });
    }
    return out;
  }
  if (product.kind === 'sound') {
    assertSoundDeliveryGate(target.name, product);
    const out: Artifact[] = product.sounds.map((s) => ({
      path: `${target.name}/${s.variant}.wav`,
      bytes: s.wav,
    }));
    if (hasHooksContent(product.hooks)) {
      out.push({ path: `${target.name}.hooks.json`, bytes: encodeUtf8(json(product.hooks)) });
    }
    return out;
  }
  if (product.kind === 'structure') return compileStructureFiles(target, product, buildKey);
  if (product.kind === 'vfx') return compileVfxFiles(target, product);
  return compileModelFiles(target, product, buildKey, key, projects, remaining);
};

const evaluateTargetGlbPerformance = (
  target: ExportTarget,
  product: CompiledProduct,
  files: readonly Artifact[],
): GlbPerformanceMetrics | undefined => {
  if (target.format !== 'glb' || (product.kind !== 'model' && product.kind !== 'structure')) {
    return undefined;
  }
  const glb = files.find((file) => file.path.endsWith('.glb'));
  if (!glb) return undefined;
  const perfKind =
    product.kind === 'structure'
      ? product.structure.grid.size[0] * product.structure.grid.size[2] > 900
        ? 'compound'
        : 'structure'
      : product.model.profile === 'creature'
        ? 'creature'
        : 'prop';
  const report = evaluateGlbPerformance(glb.bytes, perfKind);
  if (target.encoding === 'optimized' && !report.passed) {
    throw new BuildFailure(
      'quality.gate',
      `GLB "${target.name}" exceeded ${perfKind} performance budget: ${report.violations.map((v) => v.message).join(' ')}`,
      3,
    );
  }
  return report.metrics;
};

const compileExportTarget = async (
  target: ExportTarget,
  compiled: CheckedWorkspace,
  products: Map<string, CompiledProduct>,
  projects: Map<string, OpenedProject>,
  remaining: Map<string, number>,
  artifacts: Artifact[],
): Promise<CatalogAsset> => {
  const key = entryKey(target.entry);
  const product = products.get(key);
  if (!product) throw new BuildFailure('export.entry', target.name);
  const files = await compileExportFiles(
    target,
    product,
    compiled.buildKey,
    key,
    projects,
    remaining,
  );
  const performance = evaluateTargetGlbPerformance(target, product, files);
  const uses = remaining.get(key)! - 1;
  remaining.set(key, uses);
  if (uses === 0) projects.delete(key);
  const records = files
    .map((file) => {
      if (!safeRelative(file.path)) throw new BuildFailure('export.path', file.path);
      const relative = `assets/${target.name}/${file.path}`;
      artifacts.push({ path: relative, bytes: file.bytes });
      return { path: relative, sha256: digest(file.bytes), byteLength: file.bytes.length };
    })
    .sort((a, b) => compareText(a.path, b.path));
  return {
    id: target.name,
    kind: product.kind,
    directory: target.directory,
    files: records,
    metadata: buildProductMetadata(product, performance),
  };
};

const compilePackTarget = async (
  pack: PackConfig,
  assets: CatalogAsset[],
  artifacts: Artifact[],
  encoder?: PackEncoder,
): Promise<CatalogAsset> => {
  const files = await compilePack(pack, assets, artifacts, encoder);
  const records = files
    .map((file) => {
      const relative = `assets/${pack.name}/${file.path}`;
      artifacts.push({ path: relative, bytes: file.bytes });
      return { path: relative, sha256: digest(file.bytes), byteLength: file.bytes.length };
    })
    .sort((a, b) => compareText(a.path, b.path));
  const metadata: AssetMetadata =
    pack.format === 'minecraft_java'
      ? {
          minecraftVersion: pack.minecraftVersion,
          resourceRoot: 'resource-pack',
          archive: pack.archive ? `${pack.name}.zip` : null,
        }
      : {
          resourceRoot: 'game-assets',
          manifest: 'assets.json',
          archive: pack.archive ? `${pack.name}.zip` : null,
        };
  return { id: pack.name, kind: 'pack', directory: pack.directory, files: records, metadata };
};

export const compileBundle = async (
  snapshot: Snapshot,
  toolchain: string,
  encoder?: PackEncoder,
  checked = checkSnapshot(snapshot),
  bindingsTargets?: readonly HookBindingTarget[],
): Promise<CompiledBundle> => {
  const compiled = checked,
    artifacts: Artifact[] = [],
    assets: CatalogAsset[] = [];
  const products = new Map(compiled.products.map((product) => [entryKey(product.entry), product]));
  const remaining = new Map<string, number>();
  for (const target of compiled.config.exports) {
    const key = entryKey(target.entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const projects = new Map<string, OpenedProject>();
  for (const target of [...compiled.config.exports].sort((a, b) => compareText(a.name, b.name)))
    assets.push(
      await compileExportTarget(target, compiled, products, projects, remaining, artifacts),
    );
  for (const pack of [...(compiled.config.packs ?? [])].sort((a, b) => compareText(a.name, b.name)))
    assets.push(await compilePackTarget(pack, assets, artifacts, encoder));
  const effectiveToolchain = encoder
    ? json({ compiler: toolchain, vorbis: encoder.fingerprint })
    : toolchain;
  const catalog = { format: 'ashfox-catalog' as const, version: 1 as const, assets };
  const catalogBytes = encodeUtf8(json(catalog));
  artifacts.push({ path: 'catalog.json', bytes: catalogBytes });
  artifacts.sort((a, b) => compareText(a.path, b.path));
  if (new Set(artifacts.map((file) => file.path.toLowerCase())).size !== artifacts.length)
    throw new BuildFailure('export.collision', 'Duplicate output path');
  const receipt = {
    format: 'ashfox-build-receipt' as const,
    version: 1 as const,
    sourceHash: compiled.sourceHash,
    requestKey: digest(json({ buildKey: compiled.buildKey, toolchain: effectiveToolchain })),
    toolchain: effectiveToolchain,
    catalogHash: digest(catalogBytes),
    files: artifacts.map((file) => ({
      path: file.path,
      sha256: digest(file.bytes),
      byteLength: file.bytes.length,
    })),
  };
  const bindings =
    bindingsTargets && bindingsTargets.length > 0
      ? generateWorkspaceHookBindings(snapshot.files, bindingsTargets)
      : undefined;
  return {
    receipt,
    catalog,
    artifacts,
    bundleHash: digest('ashfox-bundle:1\n' + json(receipt)),
    ...(bindings && bindings.length > 0 ? { bindings } : {}),
  };
};
