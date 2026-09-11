export async function prepareSelectionPreview({
  file,
  version,
  isCurrent,
  normalize,
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
  const input = await normalize(file);
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
