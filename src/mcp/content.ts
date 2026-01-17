import { McpContentBlock, RenderPreviewResult } from '../types';

export const buildRenderPreviewContent = (result: RenderPreviewResult): McpContentBlock[] => {
  if (result.kind === 'single' && result.image) {
    const content = imageContentFromDataUri(result.image.dataUri, result.image.mime);
    return content ? [content] : [];
  }
  if (result.kind === 'sequence' && result.frames?.length) {
    const frames: McpContentBlock[] = [];
    for (const frame of result.frames) {
      const content = imageContentFromDataUri(frame.dataUri, frame.mime);
      if (content) frames.push(content);
    }
    return frames;
  }
  return [];
};

export const buildRenderPreviewStructured = (result: RenderPreviewResult): Record<string, unknown> => {
  const structured: Record<string, unknown> = { ...(result as any) };
  if (structured.image && typeof structured.image === 'object') {
    structured.image = omitDataUri(structured.image as Record<string, unknown>);
  }
  if (Array.isArray(structured.frames)) {
    structured.frames = structured.frames.map((frame) => {
      if (frame && typeof frame === 'object') {
        return omitDataUri(frame as Record<string, unknown>);
      }
      return frame;
    });
  }
  return structured;
};

const omitDataUri = (item: Record<string, unknown>) => {
  if (!('dataUri' in item)) return { ...item };
  const { dataUri, ...rest } = item;
  return { ...rest };
};

const imageContentFromDataUri = (dataUri: string, mimeType: string): McpContentBlock | null => {
  const base64 = extractBase64FromDataUri(dataUri);
  if (!base64) return null;
  return { type: 'image', data: base64, mimeType };
};

const extractBase64FromDataUri = (dataUri: string): string | null => {
  const raw = String(dataUri ?? '');
  const comma = raw.indexOf(',');
  if (comma === -1) return null;
  return raw.slice(comma + 1).trim();
};
