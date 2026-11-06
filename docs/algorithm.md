# QLSI reconstruction conventions

Source: G. Baffou, J. Phys. D: Appl. Phys. 54 (2021) 294002, §5,
and the MATLAB screenshot supplied by the author. The personal PDF is not
copied into the repository. No third-party `intgrad2` code is included.

## Correspondence with the supplied code

1. Read linear pixel values, then apply FFT2 (negative exponential convention).
2. Two disks isolate the orthogonal first orders. Coordinates are measured
   from the center of the spectrum in cycles/camera pixel.
   For an FFT of width Nx and height Ny: fx = dx/Nx, fy = dy/Ny.
   A circular disk in normalized frequency appears elliptical in pixel
   coordinates for a rectangular image.
3. The inverse FFT is demodulated by exp(-2πi(fx·x+fy·y)), equivalent to
   `circshift` recentering for integer frequency-bin coordinates.
4. g1 = α arg(H1 conj(H1ref)), likewise for g2. Without a reference: arg(H).
5. θ = atan2(fy1,fx1). gx = cosθ·g1 - sinθ·g2;
   gy = sinθ·g1 + cosθ·g2. The y axis follows image rows downward; the second
   order is at +90° from the first in this coordinate system. Swapping the
   orders or choosing their conjugates changes the sign convention.
6. Remove the mean gradients, then apply periodic spectral least-squares
   integration: Ŵ = -i(kx·ĝx+ky·ĝy)/(kx²+ky²), Ŵ(0)=0.
   Nyquist modes have zero derivative in this real-valued discretization.
   This is an alternative to `intgrad2`, not an exact translation of it.
7. The disk around zero frequency provides intensity. With a reference,
   the ratio of the filtered intensities provides transmittance.

## Units and calibration

In the paper, α = Λ/(4πd) is dimensionless; Λ and d must use the same unit.
Experimental calibration is preferable. With relay optics, the factor may
depend on wavelength. The example value α=0.00318 from the paper is not a
calibration of the user's instrument.

The screenshot uses α=0.52, followed by `intgrad2` without explicitly
multiplying by the camera pixel size. This value might incorporate a unit
conversion or a different convention. Its unit must be confirmed before
quantitative use; it is therefore not silently used as the default calibration.
If its α represents OPD per pixel in nm/rad, conversion to our convention is
α_interface = α_screenshot / camera_pixel_nm.

Our gradients are dimensionless (dW/dx_camera). Integration uses the camera
pixel size in nm to produce W in nm. Magnification is used only for the pixel
size in object space: p_object=p_camera/M. The amplitude of W is not divided
by magnification. Phase is 2πW/λ.
NA is a metadata field and does not change the calculation.

## Limitations

- Explicit central crop to power-of-two dimensions, up to 1024 × 1024.
  No rescaling or edge compensation.
- Periodic boundary conditions: edge discontinuities may degrade W.
- No unwrapping of wrapped gradients or vortex handling.
- Phase estimates in weakly modulated orders may be unreliable.
- The reference intensity threshold is max(10^-6 · |mean|, 10^-12).
  Pixels below the threshold are invalid (NaN internally, null in JSON).
- Standard uncompressed TIFF, single grayscale channel, strips, orientation 1,
  uint8/uint16 or float32; only the first page is read. BigTIFF, compression,
  tiles, RGB, other orientations and other data types are explicitly rejected.
- 8-bit grayscale PNG only; browser decoding, TIFF recommended for
  quantitative measurements. JPEG is not accepted.
- Import limits: 128 MB and 16 megapixels per file.

## Validation

`tests/core.test.mjs` checks a rectangular complex FFT, an independent
analytical field and its derivatives, a full reconstruction from two synthetic
interferograms with known OPD (±120 nm) and transmittance (0.8), calibration
and scales, identical sample/reference images, invalid parameters, and TIFF
reading in both byte orders. These tests do not replace comparison against
real acquisitions and results from the reference MATLAB software.
