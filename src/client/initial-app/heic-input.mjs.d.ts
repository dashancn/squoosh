export interface HeicNotice {
  kind: 'loading' | 'success' | 'error';
  message: string;
}

export interface HeicWorkerLike {
  inspect(
    file: File,
  ): Promise<{ isHeic: boolean; width?: number; height?: number }>;
  convert(file: File): Promise<{ buffer: ArrayBuffer; mimeType: string }>;
  terminate(): void;
}

export class CompressorHeicInput {
  constructor(options: {
    createWorkerClient(
      onProgress: (message: string) => void,
    ): Promise<HeicWorkerLike> | HeicWorkerLike;
    openFile(file: File): void;
    setNotice?(notice: HeicNotice | undefined | null): void;
    FileClass?: typeof File;
    storage?: Storage;
    decodePng?(buffer: ArrayBuffer): Promise<void>;
  });
  select(file: File): Promise<void>;
  cancel(): void;
}
