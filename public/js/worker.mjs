import { reconstruct } from './core.mjs';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: reconstruct(data.sample, data.reference, data.config) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
