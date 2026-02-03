import type { FormatDescriptor } from '../../ports/formats';
import type { FormatKind } from '../../types';
import type { BlockbenchSimProject } from './BlockbenchSim';
import { BlockbenchSim } from './BlockbenchSim';
import { getBlockbenchSpecSnapshot, getDefaultTextureResolution, getFormatDescriptor } from './BlockbenchSpec';
import type { BlockbenchSpecSnapshot } from './BlockbenchSpec';

type BlockbenchSimEngineOptions = {
  spec?: BlockbenchSpecSnapshot;
  project?: Partial<BlockbenchSimProject>;
  formatCaps?: FormatDescriptor | null;
  format?: FormatKind | null;
  formatId?: string | null;
};

export class BlockbenchSimEngine {
  readonly spec: BlockbenchSpecSnapshot;
  readonly formatDescriptor: FormatDescriptor | null;
  readonly sim: BlockbenchSim;
  readonly project: BlockbenchSimProject;

  constructor(options: BlockbenchSimEngineOptions = {}) {
    this.spec = options.spec ?? getBlockbenchSpecSnapshot();

    const format = options.format ?? options.project?.format ?? null;
    const formatId = options.formatId ?? options.project?.formatId ?? null;
    const formatDescriptor =
      options.formatCaps ?? getFormatDescriptor(this.spec, formatId, format);

    const textureResolution =
      options.project?.textureResolution === null
        ? null
        : options.project?.textureResolution ?? getDefaultTextureResolution(this.spec);

    const project: BlockbenchSimProject = {
      id: options.project?.id ?? `${Date.now()}`,
      name: options.project?.name ?? null,
      format,
      formatId: formatId ?? formatDescriptor?.id ?? options.project?.formatId ?? null,
      textureResolution
    };

    this.formatDescriptor = formatDescriptor;
    this.project = project;
    this.sim = new BlockbenchSim({
      project,
      formatCaps: formatDescriptor,
      resolveFormatCaps: (nextFormatId, nextFormat) =>
        getFormatDescriptor(this.spec, nextFormatId, nextFormat)
    });
  }

  get editor() {
    return this.sim.editor;
  }

  get snapshotPort() {
    return this.sim.snapshotPort;
  }

  get formatId(): string | null {
    return this.project.formatId ?? this.formatDescriptor?.id ?? null;
  }

  get formatName(): string | null {
    return this.formatDescriptor?.name ?? this.project.formatId ?? null;
  }

  get formatCaps(): FormatDescriptor | null {
    return this.formatDescriptor;
  }
}


