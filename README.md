# PhaseWEB

Web interface for QLSI data processing.


## Usage

Open `public/index.php`

For your data, import an uncompressed camera TIFF (grayscale uint8/uint16
or float32), then a reference with the same dimensions
if available. Set the camera pixel size, total magnification, wavelength and,
most importantly, your calibrated α factor. NA is a metadata field.
Position the two orthogonal orders in the spectrum and adjust the disk radius
before reconstructing. Coordinates are in cycles/camera pixel.

