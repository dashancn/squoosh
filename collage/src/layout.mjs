export const MAX_EDGE = 12000;

function parseRatio(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const [width, height] = String(value || '1:1').split(':').map(Number);
  return width > 0 && height > 0 ? width / height : 1;
}

function clampLayout(layout) {
  const scale = Math.min(1, MAX_EDGE / Math.max(layout.width, layout.height));
  if (scale === 1) return layout;
  return {
    width: Math.max(1, Math.round(layout.width * scale)),
    height: Math.max(1, Math.round(layout.height * scale)),
    scale,
    items: layout.items.map((item) => ({
      ...item,
      x: Math.round(item.x * scale),
      y: Math.round(item.y * scale),
      width: Math.max(1, Math.round(item.width * scale)),
      height: Math.max(1, Math.round(item.height * scale)),
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
