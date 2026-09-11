export async function prepareSelectionPreview({
  file,
  version,
  isCurrent,
  normalize,
  normalizeOptions,
  decodeValidated,
  preprocess = ({ input, bitmap }) => ({
    input,
    bitmap,
    originalWidth: bitmap.width,
    originalHeight: bitmap.height,
    processedWidth: bitmap.width,
    processedHeight: bitmap.height,
    optimized: false,
  }),
  publish,
}) {
  const input = await normalize(file, normalizeOptions);
  if (!isCurrent(version)) return null;

  let bitmap;
  let prepared;
  try {
    bitmap = await decodeValidated(input);
    if (!isCurrent(version)) return null;
    prepared = await preprocess({ input, bitmap });
    if (!isCurrent(version)) return null;
    publish({ version, ...prepared });
    return prepared.input;
  } finally {
    if (prepared?.bitmap !== bitmap) prepared?.bitmap?.close?.();
    bitmap?.close?.();
  }
}

export function createSelectionPreparationQueue() {
  let running = false;
  let pending = null;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const item = pending;
        pending = null;
        if (!item.options.isCurrent(item.options.version)) {
          item.resolve(null);
          continue;
        }
        try {
          item.resolve(await prepareSelectionPreview(item.options));
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      running = false;
      if (pending) void drain();
    }
  }

  return {
    prepare(options) {
      return new Promise((resolve, reject) => {
        pending?.resolve(null);
        pending = { options, resolve, reject };
        void drain();
      });
    },
  };
}
