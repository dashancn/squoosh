export class HeicWorkerClient {
  #WorkerClass;
  #workerUrl;
  #onProgress;
  #timeoutMs;
  #worker;
  #nextId = 0;
  #pending = new Map();

  constructor({ WorkerClass = Worker, workerUrl = new URL('./heic-worker.mjs', import.meta.url), onProgress = () => {}, timeoutMs = 300_000 } = {}) {
    this.#WorkerClass = WorkerClass;
    this.#workerUrl = workerUrl;
    this.#onProgress = onProgress;
    this.#timeoutMs = timeoutMs;
  }

  #load() {
    if (this.#worker) return this.#worker;
    const worker = new this.#WorkerClass(this.#workerUrl, { type: 'module', name: 'heic-decoder' });
    worker.onmessage = ({ data }) => {
      const pending = this.#pending.get(data?.id);
      if (!pending) return;
      if (data.type === 'progress') { this.#onProgress(data.message); return; }
      this.#pending.delete(data.id);
      clearTimeout(pending.timer);
      if (data.type === 'error') pending.reject(new Error(data.error || 'HEIC 解码失败'));
      else pending.resolve(data);
    };
    worker.onerror = (event) => {
      this.#rejectAll(event?.message ? `HEIC 解码资源不可用：${event.message}` : 'HEIC 解码资源不可用');
      worker.terminate();
      if (this.#worker === worker) this.#worker = undefined;
    };
    this.#worker = worker;
    return worker;
  }

  #request(operation, file) {
    const worker = this.#load();
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.has(id)) return;
        this.#rejectAll('HEIC 解码超时，已停止后台任务');
        worker.terminate();
        if (this.#worker === worker) this.#worker = undefined;
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, operation, file });
    });
  }

  async inspect(file) {
    const { isHeic, width, height } = await this.#request('inspect', file);
    return { isHeic: isHeic === true, width, height };
  }

  async convert(file) {
    const { buffer, mimeType } = await this.#request('convert', file);
    if (
      mimeType !== 'image/png' ||
      !(buffer instanceof ArrayBuffer) ||
      buffer.byteLength < 8
    )
      throw new Error('HEIC worker 未返回有效 PNG');
    const signature = new Uint8Array(buffer, 0, 8);
    if (
      ![137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => signature[index] === value,
      )
    )
      throw new Error('HEIC worker 未返回有效 PNG');
    return { buffer, mimeType };
  }

  #rejectAll(message) {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }
    this.#pending.clear();
  }

  terminate() {
    this.#rejectAll('HEIC 解码已取消');
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}
