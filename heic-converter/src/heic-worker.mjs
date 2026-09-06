import {
  isHeicBytes,
  inspectHeic,
  decodeHeic,
} from '../third-party/heic-to-1.5.2.worker.js';
import { validateDimensions } from './core.mjs';
import { handleHeicWorkerMessage } from './heic-worker-handler.mjs';

self.onmessage = ({ data }) =>
  handleHeicWorkerMessage(data, {
    isHeicBytes,
    inspectHeic,
    decodeHeic,
    validateDimensions,
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    postMessage: (...args) => self.postMessage(...args),
  });
