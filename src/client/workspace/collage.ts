export type CollageMode = 'grid' | 'vertical' | 'horizontal';
export type CollageRatio = 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export interface ImageSize { width: number; height: number }
export interface CollageCell { x: number; y: number; width: number; height: number; imageIndex: number }
export interface CollageLayout { width: number; height: number; cells: CollageCell[] }

const MAX_OUTPUT = 12000;

export function fitWithinLimit(width: number, height: number, limit = MAX_OUTPUT): ImageSize {
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效');
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function ratioValue(ratio: CollageRatio): number | undefined {
  if (ratio === 'auto') return undefined;
  const [width, height] = ratio.split(':').map(Number);
  return width / height;
}

export function calculateCollageLayout(
  images: ImageSize[],
  mode: CollageMode,
  options: { gap?: number; width?: number; ratio?: CollageRatio } = {},
): CollageLayout {
  if (!images.length) throw new Error('至少需要一张图片');
  const gap = Math.max(0, Math.min(200, Math.round(options.gap || 0)));
  const baseWidth = Math.max(320, Math.min(MAX_OUTPUT, Math.round(options.width || 1600)));

  if (mode === 'vertical') {
    const cells: CollageCell[] = [];
    let y = 0;
    images.forEach((image, imageIndex) => {
      const height = Math.round(baseWidth * image.height / image.width);
      cells.push({ x: 0, y, width: baseWidth, height, imageIndex });
      y += height + gap;
    });
    const fitted = fitWithinLimit(baseWidth, y - gap);
    const scale = fitted.width / baseWidth;
    return { width: fitted.width, height: fitted.height, cells: cells.map(cell => ({ ...cell, x: Math.round(cell.x * scale), y: Math.round(cell.y * scale), width: Math.round(cell.width * scale), height: Math.round(cell.height * scale) })) };
  }

  if (mode === 'horizontal') {
    const rowHeight = Math.max(320, Math.min(MAX_OUTPUT, Math.round(options.width || 1200)));
    const cells: CollageCell[] = [];
    let x = 0;
    images.forEach((image, imageIndex) => {
      const width = Math.round(rowHeight * image.width / image.height);
      cells.push({ x, y: 0, width, height: rowHeight, imageIndex });
      x += width + gap;
    });
    const fitted = fitWithinLimit(x - gap, rowHeight);
    const scale = fitted.height / rowHeight;
    return { width: fitted.width, height: fitted.height, cells: cells.map(cell => ({ ...cell, x: Math.round(cell.x * scale), y: 0, width: Math.round(cell.width * scale), height: Math.round(cell.height * scale) })) };
  }

  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const requestedRatio = ratioValue(options.ratio || 'auto');
  const canvasWidth = baseWidth;
  const canvasHeight = requestedRatio ? Math.round(canvasWidth / requestedRatio) : Math.round(canvasWidth * rows / columns);
  const cellWidth = (canvasWidth - gap * (columns - 1)) / columns;
  const cellHeight = (canvasHeight - gap * (rows - 1)) / rows;
  const cells = images.map((_, imageIndex) => ({
    x: Math.round((imageIndex % columns) * (cellWidth + gap)),
    y: Math.round(Math.floor(imageIndex / columns) * (cellHeight + gap)),
    width: Math.round(cellWidth),
    height: Math.round(cellHeight),
    imageIndex,
  }));
  return { width: canvasWidth, height: canvasHeight, cells };
}
