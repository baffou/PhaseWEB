// Deliberately restricted scientific TIFF reader; unsupported encodings fail
// explicitly instead of silently converting high-bit-depth camera values.
export function readTiff(buffer) {
  const d = new DataView(buffer), byteOrder = d.getUint16(0);
  if (![0x4949, 0x4d4d].includes(byteOrder)) throw Error('Invalid TIFF header.');
  const le = byteOrder === 0x4949, u16 = p => d.getUint16(p, le), u32 = p => d.getUint32(p, le);
  if (u16(2) !== 42) throw Error('BigTIFF is not supported. Export a standard uncompressed TIFF.');
  const ifd = u32(4), count = u16(ifd), tags = {};
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12, tag = u16(p), type = u16(p + 2), n = u32(p + 4);
    const bytes = { 1: 1, 3: 2, 4: 4 }[type];
    if (!bytes) continue;
    if (n > 1000000) throw Error('TIFF: metadata is too large.');
    const offset = n * bytes <= 4 ? p + 8 : u32(p + 8);
    if (offset + n * bytes > buffer.byteLength) throw Error('Truncated TIFF.');
    tags[tag] = Array.from({ length: n }, (_, j) => type === 3 ? u16(offset + j * 2) : type === 4 ? u32(offset + j * 4) : d.getUint8(offset + j));
  }
  const one = (tag, fallback) => tags[tag]?.[0] ?? fallback;
  const width = one(256), height = one(257), bits = one(258, 8), format = one(339, 1);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16777216) throw Error('TIFF: invalid dimensions or more than 16 megapixels.');
  if (one(259, 1) !== 1) throw Error('Compressed TIFF is not supported. Export without compression (8/16-bit or float32).');
  if (one(277, 1) !== 1 || ![0, 1].includes(one(262, 1))) throw Error('TIFF: a single grayscale channel is required.');
  if (one(274, 1) !== 1) throw Error('TIFF: unsupported orientation. Export with the origin at the top left.');
  if (tags[324] || tags[325]) throw Error('Tiled TIFF is not supported. Export using strips.');
  if (!((format === 1 && [8, 16].includes(bits)) || (format === 3 && bits === 32))) throw Error('TIFF: use uint8, uint16 or float32.');
  const offsets = tags[273], counts = tags[279], rows = one(278, height), size = bits / 8;
  if (!offsets || !counts || !Number.isInteger(rows) || rows < 1 || offsets.length !== Math.ceil(height / rows)) throw Error('TIFF: missing strips.');
  const data = new Float64Array(width * height);
  for (let s = 0; s < offsets.length; s++) {
    const length = Math.min(rows, height - s * rows) * width;
    if (counts[s] < length * size || offsets[s] + length * size > buffer.byteLength) throw Error('Truncated TIFF.');
    for (let j = 0; j < length; j++) {
      const p = offsets[s] + j * size;
      let v = format === 3 ? d.getFloat32(p, le) : bits === 16 ? u16(p) : d.getUint8(p);
      if (one(262, 1) === 0) {
        if (format === 3) throw Error('WhiteIsZero float32 TIFF is not supported.');
        v = 2 ** bits - 1 - v;
      }
      if (!Number.isFinite(v)) throw Error('TIFF: NaN or infinite value.');
      data[s * rows * width + j] = v;
    }
  }
  const extraPage = u32(ifd + 2 + count * 12) !== 0;
  return { data, width, height, note: `TIFF ${bits} bits${extraPage ? ' · first page only' : ''}` };
}

export async function readImage(file) {
  if (file.size > 128 * 1024 * 1024) throw Error('File is too large: 128 MB limit.');
  if (/\.tiff?$/i.test(file.name)) {
    try { return readTiff(await file.arrayBuffer()); }
    catch (error) { if (error instanceof RangeError) throw Error('Truncated or invalid TIFF.'); throw error; }
  }
  if (!/\.png$/i.test(file.name)) throw Error('Supported formats: uncompressed TIFF or 8-bit grayscale PNG.');
  const buffer = await file.arrayBuffer(), header = new DataView(buffer);
  if (buffer.byteLength < 33 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a) throw Error('Invalid PNG.');
  if (header.getUint8(24) !== 8 || header.getUint8(25) !== 0) throw Error('Use an 8-bit grayscale PNG (no palette, RGB or alpha), or TIFF to preserve camera values.');
  const width = header.getUint32(16), height = header.getUint32(20);
  if (width * height > 16777216) throw Error('Image is too large: 16 megapixel limit.');
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0); bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data, data = new Float64Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return { data, width, height, note: '8-bit PNG · browser decoding; TIFF recommended for measurements' };
}
