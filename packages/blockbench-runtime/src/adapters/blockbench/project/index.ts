import type { FormatKind, ToolError } from '@ashfox/blockbench-contracts/types/internal';
import type { Logger } from '../../../logging';
import type { CloseProjectPending } from '../../../ports/editor';
import { runCloseProject } from './projectClose';
import { runCreateProject } from './projectCreate';
import {
  readProjectTextureResolution,
  runSetProjectTextureResolution,
  runSetProjectUvPixelsPerBlock,
} from './projectResolution';
import { runWriteFile } from './projectWrite';

export class BlockbenchProjectAdapter {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  createProject(
    name: string,
    formatId: string,
    kind: FormatKind,
    options?: { confirmDiscard?: boolean; dialog?: Record<string, unknown> },
  ): ToolError | null {
    return runCreateProject(this.log, name, formatId, kind, options);
  }

  closeProject(options?: { force?: boolean }): ToolError | CloseProjectPending | null {
    return runCloseProject(this.log, options);
  }

  writeFile(path: string, contents: string): ToolError | null {
    return runWriteFile(this.log, path, contents);
  }

  getProjectTextureResolution(): { width: number; height: number } | null {
    return readProjectTextureResolution();
  }

  setProjectTextureResolution(width: number, height: number, modifyUv?: boolean): ToolError | null {
    return runSetProjectTextureResolution(this.log, width, height, modifyUv);
  }

  setProjectUvPixelsPerBlock(pixelsPerBlock: number): ToolError | null {
    return runSetProjectUvPixelsPerBlock(this.log, pixelsPerBlock);
  }
}
