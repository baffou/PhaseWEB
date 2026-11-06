import { crop, spectrum, demo, validate } from './core.mjs';
import { readImage } from './images.mjs';

const $ = id => document.getElementById(id), form = $('settings');
let sample = null, reference = null, result = null, fftDisplay = null, worker = null, busy = false, demoTruth = null;
const versions = { sample: 0, reference: 0 };
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
const config = () => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, Number(v)]));
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
function stats(data) {
  let min = Infinity, max = -Infinity, sum2 = 0, count = 0;
  for (const v of data) if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); sum2 += v * v; count++; }
  return { min, max, rms: Math.sqrt(sum2 / count) };
}
function draw(id, data, w, h, color = false) {
  const canvas = $(id); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(w, h), range = stats(data);
  const stops = [[20, 40, 68], [40, 100, 137], [100, 168, 167], [216, 216, 154], [246, 174, 90], [183, 63, 48]];
  for (let i = 0; i < data.length; i++) {
    const span = range.max - range.min;
    let t = span <= 1e-10 * Math.max(1, Math.abs(range.min), Math.abs(range.max)) ? .5 : Math.max(0, Math.min(1, (data[i] - range.min) / span));
    if (!Number.isFinite(data[i])) t = NaN;
    if (!Number.isFinite(t)) { image.data.set([255, 0, 255, 255], i * 4); continue; }
    if (color) {
      t *= stops.length - 1; const a = Math.min(stops.length - 2, Math.floor(t)), f = t - a;
      image.data.set([...stops[a].map((v, k) => Math.round(v * (1 - f) + stops[a + 1][k] * f)), 255], i * 4);
    } else { const v = Math.round(t * 255); image.data.set([v, v, v, 255], i * 4); }
  }
  ctx.putImageData(image, 0, 0); canvas.parentElement.classList.add('loaded'); return range;
}
function spectrumView() {
  if (!sample || !fftDisplay) return;
  draw('fourier', fftDisplay, sample.width, sample.height);
  const c = config(), ctx = $('fourier').getContext('2d'), w = sample.width, h = sample.height;
  for (const [fx, fy, color, text] of [[0, 0, '#ffffff77', '0'], [c.fx1, c.fy1, '#ffb36a', '1'], [c.fx2, c.fy2, '#69d6e5', '2']]) {
    if (![fx, fy, c.radius].every(Number.isFinite) || c.radius <= 0) continue;
    const x = (fx + .5) * w, y = (fy + .5) * h;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(w / 400, 1);
    ctx.beginPath(); ctx.ellipse(x, y, c.radius * w, c.radius * h, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `${Math.max(12, w / 24)}px monospace`; ctx.fillText(text, x + 5, y - 6);
  }
}
function invalidate(message) {
  worker?.terminate(); worker = null; busy = false; result = null;
  for (const id of ['export-csv', 'export-json']) $(id).disabled = true;
  document.querySelectorAll('.export-image').forEach(b => b.disabled = true);
  for (const id of ['intensity', 'wavefront']) $(id).parentElement.classList.remove('loaded');
  for (const id of ['pv', 'rms', 'fov', 'intensity-range', 'wave-range']) $(id).textContent = '—';
  $('warnings').hidden = true; $('run').disabled = !sample; $('run').innerHTML = 'Reconstruct images <span>→</span>';
  if (message) status(message);
}
function updateSampling() {
  const c = config(); $('sampling').textContent = `Object sampling: ${number(c.pixel * 1000 / c.magnification, 1)} nm / pixel`;
}
function showSample() {
  if (!sample) return;
  const r = draw('raw', sample.data, sample.width, sample.height);
  fftDisplay = spectrum(sample).display; spectrumView();
  $('raw-range').textContent = `${number(r.min)} → ${number(r.max)} camera units`;
  $('image-size').textContent = `${sample.width} × ${sample.height} px`;
  $('data-badge').textContent = demoTruth ? 'Synthetic demonstration' : 'Imported acquisition';
  status(`Processing area: ${sample.width} × ${sample.height} px; crop origin (${sample.x0}, ${sample.y0}) within ${sample.originalWidth} × ${sample.originalHeight} px. Select both orders, then reconstruct.`);
}
async function load(kind, file) {
  if (!file) return;
  const version = ++versions[kind];
  try {
    status('Reading image…');
    const image = await readImage(file), prepared = crop(image);
    if (version !== versions[kind]) return;
    demoTruth = null; invalidate();
    if (kind === 'sample') sample = prepared; else reference = prepared;
    $(kind + '-name').textContent = `${file.name} · ${image.width} × ${image.height} · ${image.note}`;
    $('clear-reference').hidden = !reference; showSample();
    if (sample && reference && (sample.originalWidth !== reference.originalWidth || sample.originalHeight !== reference.originalHeight)) status('Dimensions do not match: import a reference with the same dimensions or remove it.', true);
  } catch (error) { if (version === versions[kind]) status(error.message, true); }
}
for (const kind of ['sample', 'reference']) $(kind + '-file').addEventListener('change', e => load(kind, e.target.files[0]));
$('clear-reference').addEventListener('click', () => { versions.reference++; reference = null; demoTruth = null; $('reference-file').value = ''; $('reference-name').textContent = 'Optional · aberration correction'; $('clear-reference').hidden = true; invalidate('Reference removed. Run reconstruction again.'); });
form.addEventListener('input', () => { invalidate('Parameters changed. Run reconstruction again.'); updateSampling(); spectrumView(); });
$('fourier').addEventListener('click', e => {
  if (!sample || busy) return;
  const canvas = $('fourier'), rect = canvas.getBoundingClientRect();
  // object-fit: contain may letterbox rectangular images inside the canvas box.
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const left = rect.left + (rect.width - canvas.width * scale) / 2, top = rect.top + (rect.height - canvas.height * scale) / 2;
  const x = (e.clientX - left) / scale, y = (e.clientY - top) / scale;
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const order = $('pick-order').value;
  form.elements['fx' + order].value = ((Math.round(x) - canvas.width / 2) / canvas.width).toFixed(7);
  form.elements['fy' + order].value = ((Math.round(y) - canvas.height / 2) / canvas.height).toFixed(7);
  $('pick-order').value = order === '1' ? '2' : '1'; invalidate('Order positioned. Check the second order and disk radius before reconstruction.'); spectrumView();
});
function renderWave() {
  if (!result) return;
  const unit = $('wave-unit').value, range = draw('wavefront', result[unit], result.width, result.height, true);
  $('wave-range').textContent = `${number(range.min)} → ${number(range.max)} ${unit === 'opd' ? 'nm' : 'rad'} · auto scale`;
}
function renderResult() {
  const r = result, data = r.transmittance ?? r.intensity;
  const range = draw('intensity', data, r.width, r.height);
  $('intensity-title').textContent = r.transmittance ? 'Transmittance' : 'Reconstructed intensity';
  $('intensity-unit').textContent = r.transmittance ? 'T / T REF' : 'CAMERA UNITS';
  $('intensity-range').textContent = `${number(range.min, 3)} → ${number(range.max, 3)} ${r.transmittance ? 'dimensionless' : 'camera units'} · auto scale`;
  renderWave(); const s = stats(r.opd);
  $('pv').innerHTML = `${number(s.max - s.min)} <small>nm</small>`; $('rms').innerHTML = `${number(s.rms)} <small>nm</small>`;
  $('fov').innerHTML = `${number(r.width * r.samplePitchUm, 1)} × ${number(r.height * r.samplePitchUm, 1)} <small>µm</small>`;
  $('warnings').replaceChildren();
  const warnings = [...r.warnings];
  if (!demoTruth) warnings.push('Quantitative accuracy depends on your α calibration; the initial value is not a calibration of your microscope.');
  for (const message of warnings) { const p = document.createElement('p'); p.textContent = message; $('warnings').append(p); }
  $('warnings').hidden = !warnings.length;
  $('export-csv').disabled = false; $('export-json').disabled = false; document.querySelectorAll('.export-image').forEach(b => b.disabled = false);
  let message = `Reconstruction complete · ${r.width} × ${r.height} px · piston and mean tilt removed.`;
  if (demoTruth) { const rms = Math.sqrt(r.opd.reduce((sum, v, i) => sum + (v - demoTruth[i]) ** 2, 0) / r.opd.length); message += ` RMS error against the synthetic model: ${number(rms, 4)} nm.`; }
  status(message);
}
function run() {
  if (!sample || busy || !form.reportValidity()) return;
  let c;
  try { c = config(); validate(c); } catch (e) { status(e.message, true); return; }
  busy = true; $('run').disabled = true; $('run').textContent = 'Reconstructing…'; status('FFT, demodulation and gradient integration…');
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  const finish = () => { busy = false; $('run').disabled = false; $('run').innerHTML = 'Reconstruct images <span>→</span>'; worker?.terminate(); worker = null; };
  worker.onmessage = ({ data }) => { finish(); if (data.error) { invalidate(); status(data.error, true); } else { result = data.result; renderResult(); } };
  worker.onerror = () => { finish(); invalidate(); status('Calculation failed. Check the images and serve the application over HTTP (not file://).', true); };
  worker.postMessage({ sample, reference, config: c });
}
form.addEventListener('submit', e => { e.preventDefault(); run(); });
$('wave-unit').addEventListener('change', renderWave);
$('demo').addEventListener('click', () => {
  versions.sample++; versions.reference++; invalidate();
  const d = demo(); sample = crop(d.sample); reference = crop(d.reference); demoTruth = d.truth;
  for (const [key, value] of Object.entries(d.config)) form.elements[key].value = value;
  $('sample-file').value = ''; $('reference-file').value = '';
  $('sample-name').textContent = 'Synthetic sample · 256 × 256 · float64'; $('reference-name').textContent = 'Synthetic blank field · 256 × 256'; $('clear-reference').hidden = false;
  updateSampling(); showSample(); run();
});
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-json').addEventListener('click', () => {
  if (!result) return;
  const r = result, payload = { format: 'PhaseWEB-QLSI-v1', created: new Date().toISOString(), width: r.width, height: r.height, config: r.config, crop: r.crop, samplePitchUm: r.samplePitchUm, units: { opd: 'nm', phase: 'rad', intensity: 'camera units', transmittance: 'dimensionless', gx: 'dimensionless', gy: 'dimensionless' }, convention: 'x right, y down; alpha dimensionless/rad; piston and mean tilt removed; periodic spectral integration; row-major arrays', warnings: r.warnings };
  payload.calibration = demoTruth ? 'Synthetic demonstration calibration' : 'User-supplied alpha; experimental calibration not verified';
  payload.source = { sample: $('sample-name').textContent, reference: reference ? $('reference-name').textContent : null };
  if (!demoTruth) payload.warnings = [...payload.warnings, 'Quantitative accuracy depends on experimental alpha calibration.'];
  for (const key of ['opd', 'phase', 'intensity', 'transmittance', 'gx', 'gy']) payload[key] = r[key] ? Array.from(r[key], v => Number.isFinite(v) ? v : null) : null;
  download(new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'phaseweb-results.json');
});
$('export-csv').addEventListener('click', () => {
  if (!result) return;
  const r = result, lines = ['# PhaseWEB OPD [nm]; rows=y down; columns=x right; piston and mean tilt removed', `# config=${JSON.stringify(r.config)}; crop=${JSON.stringify(r.crop)}; sample_pitch_um=${r.samplePitchUm}`];
  for (let y = 0; y < r.height; y++) lines.push(Array.from(r.opd.subarray(y * r.width, (y + 1) * r.width)).join(','));
  download(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), 'phaseweb-opd-nm.csv');
});
document.querySelectorAll('.export-image').forEach(button => button.addEventListener('click', () => {
  if (!result) return;
  const target = button.dataset.target, filename = target === 'wavefront' ? $('wave-unit').value : result.transmittance ? 'transmittance' : 'intensity';
  $(target).toBlob(blob => { if (blob) download(blob, `phaseweb-${filename}-normalized.png`); });
}));
updateSampling();
