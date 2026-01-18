import { FormatDescriptor, FormatPort } from '../../ports/formats';
import { readBlockbenchGlobals } from '../../types/blockbench';

export class BlockbenchFormats implements FormatPort {
  listFormats(): FormatDescriptor[] {
    const globals = readBlockbenchGlobals();
    const formats = globals.Formats ?? globals.ModelFormat?.formats ?? {};
    if (!formats || typeof formats !== 'object') return [];
    return Object.entries(formats).map(([id, format]) => ({
      id,
      name: format?.name ?? id
    }));
  }

  getActiveFormatId(): string | null {
    const globals = readBlockbenchGlobals();
    const active = globals.Format ?? globals.ModelFormat?.selected ?? null;
    return active?.id ?? null;
  }
}
