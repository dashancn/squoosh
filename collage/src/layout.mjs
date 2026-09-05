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
    width, height, scale: Math.min(width / layout.width, height / layout.height),
    items: layout.items.map((item) => ({
      ...item, x: Math.floor(item.x * scale), y: Math.floor(item.y * scale),
      width: Math.max(1, Math.floor(item.width * scale)),
      height: Math.max(1, Math.floor(item.height * scale)),
    })),
  };
}

function focalAt(options, index) {
  if (!options.focalPoints?.[index]) return undefined;
  const focal = options.focalPoints[index];
  const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0.5));
  return { x: clamp(focal.x), y: clamp(focal.y) };
}

function withFocal(item, options, index) {
  const focal = focalAt(options, index);
  return focal ? { ...item, focal } : item;
}

function fixedGrid(images, options, columns, rows = Math.ceil(images.length / columns)) {
  const spacing = Math.max(0, Number(options.spacing) || 0);
  const cellWidth = Math.max(1, Math.round(Number(options.cellWidth) || 400));
  const cellHeight = Math.max(1, Math.round(cellWidth / parseRatio(options.ratio)));
  return clampLayout({
    width: columns * cellWidth + (columns - 1) * spacing,
    height: rows * cellHeight + (rows - 1) * spacing,
    scale: 1,
    items: images.map((_, index) => withFocal({
      x: (index % columns) * (cellWidth + spacing),
      y: Math.floor(index / columns) * (cellHeight + spacing),
      width: cellWidth, height: cellHeight, fit: 'cover',
    }, options, index)),
  });
}

function splitExtent(total, spacing) {
  const available = Math.max(2, total - spacing);
  const first = Math.ceil(available / 2);
  return [first, available - first];
}

function decorativeLayout(images, options, mode) {
  const spacing = Math.max(0, Number(options.spacing) || 0);
  const cellWidth = Math.max(1, Math.round(Number(options.cellWidth) || 400));
  const cellHeight = Math.max(1, Math.round(cellWidth / parseRatio(options.ratio)));
  const doubleWidth = cellWidth * 2 + spacing;
  const doubleHeight = cellHeight * 2;
  const [upperHeight, lowerHeight] = splitExtent(doubleHeight, spacing);
  let width = doubleWidth;
  let height = mode.includes('feature') && !mode.includes('stack') ? cellHeight * 2 + spacing : doubleHeight;
  let rectangles;
  if (mode === 'left-stack-right-feature') rectangles = [[0, 0, cellWidth, upperHeight], [0, upperHeight + spacing, cellWidth, lowerHeight], [cellWidth + spacing, 0, cellWidth, doubleHeight]];
  else if (mode === 'top-feature-bottom-pair') rectangles = [[0, 0, doubleWidth, cellHeight], [0, cellHeight + spacing, cellWidth, cellHeight], [cellWidth + spacing, cellHeight + spacing, cellWidth, cellHeight]];
  else if (mode === 'bottom-feature-top-pair') rectangles = [[0, 0, cellWidth, cellHeight], [cellWidth + spacing, 0, cellWidth, cellHeight], [0, cellHeight + spacing, doubleWidth, cellHeight]];
  else {
    width = cellWidth * 3 + spacing * 2;
    height = cellHeight * 2 + spacing;
    rectangles = [[0, 0, doubleWidth, cellHeight], [doubleWidth + spacing, 0, cellWidth, height], [0, cellHeight + spacing, cellWidth, cellHeight], [cellWidth + spacing, cellHeight + spacing, cellWidth, cellHeight]];
  }
  const items = rectangles.map(([x, y, itemWidth, itemHeight], index) => withFocal({ x, y, width: itemWidth, height: itemHeight, fit: 'cover' }, options, index));
  for (let index = rectangles.length; index < images.length; index += 1) {
    items.push(withFocal({ x: width + spacing, y: 0, width: cellWidth, height, fit: 'cover' }, options, index));
    width += cellWidth + spacing;
  }
  return clampLayout({ width, height, scale: 1, items });
}

export function calculateLayout(images, options = {}) {
  if (!Array.isArray(images) || images.length === 0) throw new Error('At least one image is required');
  const spacing = Math.max(0, Number(options.spacing) || 0);
  const mode = options.mode || 'grid';
  if (mode === 'grid') return fixedGrid(images, options, Math.max(1, Math.min(images.length, Math.round(Number(options.columns) || Math.ceil(Math.sqrt(images.length))))));
  if (mode === 'two-columns') return fixedGrid(images, options, Math.min(2, images.length));
  if (mode === 'two-rows') return fixedGrid(images, options, Math.max(1, Math.ceil(images.length / 2)), Math.min(2, images.length));
  if (mode === 'four-grid') return fixedGrid(images, options, Math.min(2, images.length));
  if (mode === 'three-feature') {
    if (images.length < 3) return fixedGrid(images, options, images.length);
    const cellWidth = Math.max(1, Math.round(Number(options.cellWidth) || 400));
    const cellHeight = Math.max(1, Math.round(cellWidth / parseRatio(options.ratio)));
    const [upperHeight, lowerHeight] = splitExtent(cellHeight * 2, spacing);
    const items = [
      { x: 0, y: 0, width: cellWidth, height: cellHeight * 2, fit: 'cover', focal: focalAt(options, 0) },
      { x: cellWidth + spacing, y: 0, width: cellWidth, height: upperHeight, fit: 'cover', focal: focalAt(options, 1) },
      { x: cellWidth + spacing, y: upperHeight + spacing, width: cellWidth, height: lowerHeight, fit: 'cover', focal: focalAt(options, 2) },
    ];
    for (let index = 3; index < images.length; index += 1) items.push({ x: (index - 2) * (cellWidth + spacing), y: 0, width: cellWidth, height: cellHeight * 2, fit: 'cover', focal: focalAt(options, index) });
    return clampLayout({ width: (images.length - 1) * cellWidth + (images.length - 2) * spacing, height: cellHeight * 2, scale: 1, items });
  }
  if (['left-stack-right-feature', 'top-feature-bottom-pair', 'bottom-feature-top-pair'].includes(mode)) return images.length < 3 ? fixedGrid(images, options, images.length) : decorativeLayout(images, options, mode);
  if (mode === 'asymmetric-mosaic') return images.length < 4 ? fixedGrid(images, options, images.length) : decorativeLayout(images, options, mode);
  if (mode === 'vertical') {
    const targetWidth = Math.max(1, Math.round(Number(options.targetWidth) || Math.max(...images.map((image) => image.width))));
    let y = 0;
    const items = images.map((image, index) => { const height = Math.max(1, Math.round((targetWidth * image.height) / image.width)); const item = { x: 0, y, width: targetWidth, height, fit: 'contain', focal: focalAt(options, index) }; y += height + spacing; return item; });
    return clampLayout({ width: targetWidth, height: y - spacing, scale: 1, items });
  }
  if (mode === 'horizontal') {
    const targetHeight = Math.max(1, Math.round(Number(options.targetHeight) || Math.max(...images.map((image) => image.height))));
    let x = 0;
    const items = images.map((image, index) => { const width = Math.max(1, Math.round((targetHeight * image.width) / image.height)); const item = { x, y: 0, width, height: targetHeight, fit: 'contain', focal: focalAt(options, index) }; x += width + spacing; return item; });
    return clampLayout({ width: x - spacing, height: targetHeight, scale: 1, items });
  }
  throw new Error(`Unsupported collage mode: ${mode}`);
}
