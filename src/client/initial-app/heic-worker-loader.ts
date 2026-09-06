export async function createHeicWorkerClient(
  onProgress: (message: string) => void,
): Promise<any> {
  const { HeicWorkerClient } = await import('./heic-worker-client.mjs');
  return new HeicWorkerClient({
    workerUrl: '/heic-converter/src/heic-worker.mjs',
    onProgress,
  });
}

// The created Worker uses { type: 'module' }; its route and LGPL runtime remain
// owned by /heic-converter/ so the compressor does not duplicate the 3 MB asset.
