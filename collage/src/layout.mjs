export const MAX_EDGE = 10000;
export const MAX_OUTPUT_PIXELS = 36_000_000;

function parseRatio(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const [width, height] = String(value || '1:1').split(':').map(Number);
  return width > 0 && height > 0 ? width / height : 1;
}

function clampLayout(layout) {
  const edgeScale = MAX_EDGE / Math.max(layout.width, layout.height);
  const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS / (layout.width * layout.height));
  const scale = Math.min(1, edgeScale, pixelScale);
  if (scale === 1) return layout;
  const width = Math.max(1, Math.floor(layout.width * scale));
  const height = Math.max(1, Math.floor(layout.height * scale));
  return {
    width,
    height,
    scale: Math.min(width / layout.width, height / layout.height),
    items: layout.items.map((item) => ({
      ...item,
      x: Math.floor(item.x * scale),
      y: Math.floor(item.y * scale),
      width: Math.max(1, Math.floor(item.width * scale)),
      height: Math.max(1, Math.floor(item.height * scale)),
    })),
  };
}

export function calculateLayout(images, options = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('At least one image is required');
  }
  const spacing = Math.max(0, Number(options.spacing) || 0);
  const mode = options.mode || 'grid';

  if (mode === 'grid') {
    const columns = Math.max(
      1,
      Math.min(
        images.length,
        Math.round(Number(options.columns) || Math.ceil(Math.sqrt(images.length))),
      ),
    );
    const rows = Math.ceil(images.length / columns);
    const cellWidth = Math.max(1, Math.round(Number(options.cellWidth) || 400));
    const cellHeight = Math.max(1, Math.round(cellWidth / parseRatio(options.ratio)));
    return clampLayout({
      width: columns * cellWidth + (columns - 1) * spacing,
      height: rows * cellHeight + (rows - 1) * spacing,
      scale: 1,
      items: images.map((_, index) => ({
        x: (index % columns) * (cellWidth + spacing),
        y: Math.floor(index / columns) * (cellHeight + spacing),
        width: cellWidth,
        height: cellHeight,
        fit: 'cover',
      })),
    });
  }

  if (mode === 'vertical') {
    const targetWidth = Math.max(
      1,
      Math.round(Number(options.targetWidth) || Math.max(...images.map((image) => image.width))),
    );
    let y = 0;
    const items = images.map((image) => {
      const height = Math.max(1, Math.round((targetWidth * image.height) / image.width));
      const item = { x: 0, y, width: targetWidth, height, fit: 'contain' };
      y += height + spacing;
      return item;
    });
    return clampLayout({
      width: targetWidth,
      height: y - spacing,
      scale: 1,
      items,
    });
  }

  if (mode === 'horizontal') {
    const targetHeight = Math.max(
      1,
      Math.round(Number(options.targetHeight) || Math.max(...images.map((image) => image.height))),
    );
    let x = 0;
    const items = images.map((image) => {
      const width = Math.max(1, Math.round((targetHeight * image.width) / image.height));
      const item = { x, y: 0, width, height: targetHeight, fit: 'contain' };
      x += width + spacing;
      return item;
    });
    return clampLayout({
      width: x - spacing,
      height: targetHeight,
      scale: 1,
      items,
    });
  }

  throw new Error(`Unsupported collage mode: ${mode}`);
}
