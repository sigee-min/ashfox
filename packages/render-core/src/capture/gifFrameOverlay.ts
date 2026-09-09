import {
  GIF_CAPTURE_HEIGHT,
  GIF_CAPTURE_WIDTH
} from './gifCaptureSurface';

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  const right = x + width;
  const bottom = y + height;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(right - radius, y);
  context.quadraticCurveTo(right, y, right, y + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(x + radius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
};

const fillPanel = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void => {
  context.fillStyle = 'rgba(10, 14, 18, 0.78)';
  roundedRect(context, x, y, width, height, 7);
  context.fill();
};

export const drawShowcasePhase = (context: CanvasRenderingContext2D, label: string): void => {
  context.save();
  context.font = '500 13px system-ui, sans-serif';
  context.fillStyle = '#e5c396';
  context.fillText(label, 22, 32);
  context.restore();
};

export const drawBuildFrameOverlay = (
  context: CanvasRenderingContext2D,
  label: string,
  eventIndex: number,
  eventCount: number,
  progress: number
): void => {
  context.save();
  context.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  const heading = `REPLAY · ${eventIndex + 1}/${eventCount}`;
  context.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  const copy = label.slice(0, 58);
  const panelWidth = Math.min(
    GIF_CAPTURE_WIDTH - 28,
    Math.max(184, context.measureText(copy).width + 24)
  );
  fillPanel(context, 14, 14, panelWidth, 52);
  context.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = '#f0b65d';
  context.fillText(heading, 25, 33);
  context.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = '#f1e7d2';
  context.fillText(copy, 25, 53);

  const trackX = 14;
  const trackY = GIF_CAPTURE_HEIGHT - 10;
  const trackWidth = GIF_CAPTURE_WIDTH - 28;
  context.fillStyle = 'rgba(10, 14, 18, 0.72)';
  context.fillRect(trackX, trackY, trackWidth, 3);
  context.fillStyle = '#f0b65d';
  context.fillRect(
    trackX,
    trackY,
    Math.max(2, trackWidth * Math.min(1, Math.max(0, progress))),
    3
  );
  context.restore();
};
