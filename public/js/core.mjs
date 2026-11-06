// QLSI demodulation, Eq. (8)-(9), Baffou, J. Phys. D 54 (2021) 294002.
// Coordinates: image x right, image y down; frequencies in cycles/camera pixel.
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) || im.length !== n) throw Error('FFT: invalid size.');
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len *= 2) {
    const a = (inverse ? 2 : -2) * Math.PI / len, cr = Math.cos(a), ci = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j, v = u + len / 2;
        const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v];
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        [wr, wi] = [wr * cr - wi * ci, wr * ci + wi * cr];
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export function fft2(data, width, height, inverse = false) {
  const re = new Float64Array(data.re ?? data), im = new Float64Array(data.im ?? re.length);
  for (let y = 0; y < height; y++) fft(re.subarray(y * width, (y + 1) * width), im.subarray(y * width, (y + 1) * width), inverse);
  const a = new Float64Array(height), b = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) { a[y] = re[y * width + x]; b[y] = im[y * width + x]; }
    fft(a, b, inverse);
    for (let y = 0; y < height; y++) { re[y * width + x] = a[y]; im[y * width + x] = b[y]; }
  }
  return { re, im };
}

const frequency = (i, n) => (i < n / 2 ? i : i - n) / n;
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

export function crop(image, maxSize = 1024) {
  if (image.width < 32 || image.height < 32) throw Error('Image is too small: minimum 32 × 32.');
  const width = 2 ** Math.floor(Math.log2(Math.min(image.width, maxSize)));
  const height = 2 ** Math.floor(Math.log2(Math.min(image.height, maxSize)));
  const x0 = Math.floor((image.width - width) / 2), y0 = Math.floor((image.height - height) / 2);
  const data = new Float64Array(width * height);
  for (let y = 0; y < height; y++) data.set(image.data.subarray((y + y0) * image.width + x0, (y + y0) * image.width + x0 + width), y * width);
  if (!data.every(Number.isFinite)) throw Error('The image contains non-finite values.');
  return { data, width, height, x0, y0, originalWidth: image.width, originalHeight: image.height };
}

export function spectrum(image) {
  const f = fft2(image.data, image.width, image.height);
  const display = new Float64Array(image.data.length);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = ((y + image.height / 2) % image.height) * image.width + (x + image.width / 2) % image.width;
    display[y * image.width + x] = Math.log1p(Math.hypot(f.re[i], f.im[i]));
  }
  return { f, display };
}

export function validate(c) {
  for (const key of ['pixel', 'magnification', 'wavelength', 'alpha', 'radius']) if (!Number.isFinite(c[key]) || c[key] <= 0) throw Error(`Parameter ${key}: a positive value is required.`);
  for (const key of ['fx1', 'fy1', 'fx2', 'fy2']) if (!Number.isFinite(c[key]) || Math.abs(c[key]) >= .5) throw Error('Orders must lie inside the spectrum (−0.5 to 0.5).');
  const a = Math.hypot(c.fx1, c.fy1), b = Math.hypot(c.fx2, c.fy2);
  if (a < .02 || b < .02) throw Error('Orders must be distinct from the zero order.');
  if (Math.abs((c.fx1 * c.fx2 + c.fy1 * c.fy2) / a / b) > .08) throw Error('Choose two orthogonal orders (tolerance ≈ 4.6°).');
  if (Math.abs(a - b) / Math.max(a, b) > .08) throw Error('Both orders must have the same spatial frequency magnitude.');
  if (c.fx1 * c.fy2 - c.fy1 * c.fx2 <= 0) throw Error('Orientation: order 2 must be at +90° from order 1 (y points down).');
  if (c.radius >= Math.min(a, b) / 2) throw Error('Radius is too large: the disks must be separated from the zero order.');
  for (const [x, y] of [[c.fx1, c.fy1], [c.fx2, c.fy2]]) if (Math.abs(x) + c.radius >= .5 || Math.abs(y) + c.radius >= .5) throw Error('The filtering disk extends beyond the spectrum.');
}

function band(f, width, height, fx, fy, radius) {
  const re = new Float64Array(width * height), im = new Float64Array(re.length);
  // Keep original frequency positions, then demodulate in real space. This also
  // supports sub-bin carrier positions without rounding the selected frequency.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (Math.hypot(frequency(x, width) - fx, frequency(y, height) - fy) < radius) { re[i] = f.re[i]; im[i] = f.im[i]; }
  }
  const out = fft2({ re, im }, width, height, true);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, angle = -2 * Math.PI * (fx * x + fy * y), co = Math.cos(angle), si = Math.sin(angle);
    [out.re[i], out.im[i]] = [out.re[i] * co - out.im[i] * si, out.re[i] * si + out.im[i] * co];
  }
  return out;
}

// Periodic least-squares integration using continuous spectral derivatives.
// Inputs dW/dx, dW/dy are dimensionless; camera pixel pitch is in nm.
export function integrate(gx, gy, width, height, pitchNm) {
  const mx = mean(gx), my = mean(gy);
  const a = fft2(Float64Array.from(gx, v => v - mx), width, height);
  const b = fft2(Float64Array.from(gy, v => v - my), width, height);
  const re = new Float64Array(gx.length), im = new Float64Array(gx.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const kx = x === width / 2 ? 0 : 2 * Math.PI * frequency(x, width) / pitchNm;
    const ky = y === height / 2 ? 0 : 2 * Math.PI * frequency(y, height) / pitchNm;
    const d = kx * kx + ky * ky;
    if (d) { re[i] = (kx * a.im[i] + ky * b.im[i]) / d; im[i] = -(kx * a.re[i] + ky * b.re[i]) / d; }
  }
  return fft2({ re, im }, width, height, true).re;
}

export function reconstruct(sample, reference, c) {
  validate(c);
  if (reference && (sample.originalWidth !== reference.originalWidth || sample.originalHeight !== reference.originalHeight)) throw Error('Sample and reference have different original dimensions.');
  const { width: w, height: h } = sample, n = w * h;
  const { f, display } = spectrum(sample), fr = reference ? spectrum(reference).f : null;
  const intensity = band(f, w, h, 0, 0, c.radius).re;
  const refIntensity = fr ? band(fr, w, h, 0, 0, c.radius).re : null;
  const gradients = [], warnings = [];
  if (!fr) warnings.push('No reference: static aberrations are retained; intensity is in camera units.');
  for (const [fx, fy] of [[c.fx1, c.fy1], [c.fx2, c.fy2]]) {
    const a = band(f, w, h, fx, fy, c.radius), b = fr ? band(fr, w, h, fx, fy, c.radius) : null;
    const g = new Float64Array(n);
    let peak = 0, refPeak = 0;
    for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.hypot(a.re[i], a.im[i])); if (b) refPeak = Math.max(refPeak, Math.hypot(b.re[i], b.im[i])); }
    let weak = 0, wrapped = 0;
    for (let i = 0; i < n; i++) {
      const phase = b ? Math.atan2(a.im[i] * b.re[i] - a.re[i] * b.im[i], a.re[i] * b.re[i] + a.im[i] * b.im[i]) : Math.atan2(a.im[i], a.re[i]);
      if (Math.abs(phase) > .9 * Math.PI) wrapped++;
      if (Math.hypot(a.re[i], a.im[i]) < Math.max(peak * .01, 1e-12) || (b && Math.hypot(b.re[i], b.im[i]) < Math.max(refPeak * .01, 1e-12))) weak++;
      g[i] = c.alpha * phase;
    }
    if (weak > n * .01) warnings.push('Weakly modulated order: check the disks and signal quality.');
    if (wrapped) warnings.push('Gradients close to ±π: risk of wrapping; no phase unwrapping is applied.');
    gradients.push(g);
  }
  const theta = Math.atan2(c.fy1, c.fx1), co = Math.cos(theta), si = Math.sin(theta);
  const gx = new Float64Array(n), gy = new Float64Array(n);
  for (let i = 0; i < n; i++) { gx[i] = co * gradients[0][i] - si * gradients[1][i]; gy[i] = si * gradients[0][i] + co * gradients[1][i]; }
  const opd = integrate(gx, gy, w, h, c.pixel * 1000);
  const phase = Float64Array.from(opd, v => 2 * Math.PI * v / c.wavelength);
  let transmittance = null;
  if (refIntensity) {
    const threshold = Math.max(Math.abs(mean(refIntensity)) * 1e-6, 1e-12);
    transmittance = Float64Array.from(intensity, (v, i) => refIntensity[i] > threshold ? v / refIntensity[i] : NaN);
    if (transmittance.some(v => !Number.isFinite(v))) warnings.push('Dark reference: invalid transmittance pixels are exported as null.');
  }
  return { width: w, height: h, intensity, transmittance, opd, phase, gx, gy, spectrum: display, warnings: [...new Set(warnings)], config: c, crop: { x: sample.x0, y: sample.y0, originalWidth: sample.originalWidth, originalHeight: sample.originalHeight }, samplePitchUm: c.pixel / c.magnification };
}

export function demo() {
  const width = 256, height = 256, n = width * height;
  const config = { pixel: 6.5, magnification: 60, wavelength: 550, alpha: .00318, radius: .10, fx1: 80 / 256, fy1: 32 / 256, fx2: -32 / 256, fy2: 80 / 256 };
  const sample = new Float64Array(n), reference = new Float64Array(n), truth = new Float64Array(n);
  const theta = Math.atan2(config.fy1, config.fx1), co = Math.cos(theta), si = Math.sin(theta);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, ax = 2 * Math.PI * x / width, ay = 2 * Math.PI * y / height;
    truth[i] = 120 * Math.cos(ax) * Math.cos(ay);
    const gx = -120 * 2 * Math.PI / width / 6500 * Math.sin(ax) * Math.cos(ay);
    const gy = -120 * 2 * Math.PI / height / 6500 * Math.cos(ax) * Math.sin(ay);
    const p1 = (co * gx + si * gy) / config.alpha, p2 = (-si * gx + co * gy) / config.alpha;
    const c1 = 2 * Math.PI * (config.fx1 * x + config.fy1 * y), c2 = 2 * Math.PI * (config.fx2 * x + config.fy2 * y);
    reference[i] = 1000 * (1 + .3 * Math.cos(c1) + .3 * Math.cos(c2));
    sample[i] = 800 * (1 + .3 * Math.cos(c1 + p1) + .3 * Math.cos(c2 + p2));
  }
  return { sample: { data: sample, width, height }, reference: { data: reference, width, height }, truth, config };
}
