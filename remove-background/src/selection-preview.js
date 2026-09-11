export async function prepareSelectionPreview({
  file,
  version,
  isCurrent,
  normalize,
  decodeValidated,
  publish,
}) {
  const input = await normalize(file);
  if (!isCurrent(version)) return null;

  let bitmap;
  try {
    bitmap = await decodeValidated(input);
    if (!isCurrent(version)) return null;
    publish({ version, input, bitmap });
    return input;
  } finally {
    bitmap?.close?.();
  }
}
