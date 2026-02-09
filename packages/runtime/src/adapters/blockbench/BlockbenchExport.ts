import {
  ExportCodecParams,
  ExportGltfParams,
  ExportPort,
  ExportNativeParams,
  NativeCodecTarget
} from '../../ports/exporter';
import { ToolError } from '@ashfox/contracts/types/internal';
import { errorMessage, Logger } from '../../logging';
import { BlockbenchCompileAdapter } from './export/BlockbenchCompileAdapter';
import { BlockbenchWriteAdapter } from './export/BlockbenchWriteAdapter';

export class BlockbenchExport implements ExportPort {
  private readonly log: Logger;
  private readonly compileAdapter: BlockbenchCompileAdapter;
  private readonly writeAdapter: BlockbenchWriteAdapter;

  constructor(log: Logger) {
    this.log = log;
    this.compileAdapter = new BlockbenchCompileAdapter(log);
    this.writeAdapter = new BlockbenchWriteAdapter(log);
  }

  exportNative(params: ExportNativeParams): ToolError | null {
    try {
      const compiled = this.compileAdapter.compileNativeFormat(params.formatId);
      if (!compiled.ok) return compiled.error;
      return this.writeAdapter.writeNativeText(params.destPath, compiled.compiled);
    } catch (err) {
      const message = errorMessage(err, 'native export failed');
      this.log.error('native export error', { message });
      return { code: 'io_error', message };
    }
  }

  async exportGltf(params: ExportGltfParams): Promise<ToolError | null> {
    try {
      const compiled = await this.compileAdapter.compileGltf();
      if (!compiled.ok) return compiled.error;
      return await this.writeAdapter.writeCodecOutput(
        params.destPath,
        compiled.selection.codecId,
        compiled.selection.codec,
        compiled.selection.compiled
      );
    } catch (err) {
      const message = errorMessage(err, 'gltf export failed');
      this.log.error('gltf export error', { message });
      return { code: 'io_error', message };
    }
  }

  async exportCodec(params: ExportCodecParams): Promise<ToolError | null> {
    try {
      const compiled = await this.compileAdapter.compileCodec(params.codecId);
      if (!compiled.ok) return compiled.error;
      return await this.writeAdapter.writeCodecOutput(
        params.destPath,
        compiled.selection.codecId,
        compiled.selection.codec,
        compiled.selection.compiled
      );
    } catch (err) {
      const message = errorMessage(err, `codec export failed: ${params.codecId}`);
      this.log.error('codec export error', { message, codecId: params.codecId });
      return { code: 'io_error', message };
    }
  }

  listNativeCodecs(): NativeCodecTarget[] {
    return this.compileAdapter.listNativeCodecs();
  }
}



