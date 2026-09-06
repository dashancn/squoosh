export class HeicWorkerClient {
  constructor(options?: {
    workerUrl?: string;
    onProgress?: (message: string) => void;
    timeoutMs?: number;
  });
  inspect(
    file: File,
  ): Promise<{ isHeic: boolean; width?: number; height?: number }>;
  convert(file: File): Promise<{ buffer: ArrayBuffer; mimeType: string }>;
  terminate(): void;
}
