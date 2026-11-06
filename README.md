# PhaseWEB

Web interface for QLSI data processing.

English HTML/CSS/JavaScript interface with an optional PHP entry point.
Images are processed in a browser Web Worker; no files are uploaded.
No remote libraries or npm installation are required.

## Usage

Open `http://127.0.0.1:8080/index.php` after starting Docker as described below.
**Load demonstration** runs a synthetic reconstruction with a known OPD
of ±120 nm and a transmittance of 0.8.

For your data, import an uncompressed camera TIFF (grayscale uint8/uint16
or float32) or an 8-bit grayscale PNG, then a reference with the same dimensions
if available. Set the camera pixel size, total magnification, wavelength and,
most importantly, your calibrated α factor. NA is a metadata field.
Position the two orthogonal orders in the spectrum and adjust the disk radius
before reconstructing. Coordinates are in cycles/camera pixel.

The processing area is a central crop with power-of-two dimensions, up to
1024 × 1024, without resampling. The interface displays its dimensions and
origin. JSON preserves numerical maps, units, parameters and crop information;
CSV preserves OPD and parameters. PNG exports are normalized for visualization
and are not quantitative exports.

See the [scientific conventions and limitations](docs/algorithm.md), especially
the possible difference in units between α=0.52 in the MATLAB screenshot and
the dimensionless factor used here. Validation against real measurements is
still required; no experimental image files have been supplied.

Without Docker, an existing PHP server is sufficient:

```sh
php -S 127.0.0.1:8080 -t public
```

The interface can also be served by a static HTTP server from `public/`
using `index.html`. Do not open it directly with `file://`.

## Numerical tests

With Node.js 20 or later:

```sh
node --test tests/core.test.mjs
```

## Docker sandbox on macOS

The sandbox uses PHP 8.4 and serves `public/`. Docker Desktop must be
installed and running; Docker Compose is not required.

From the repository directory:

```sh
sh sandbox/sandbox.sh start
sh sandbox/sandbox.sh test
sh sandbox/sandbox.sh shell
```

The shell opens in `/workspace`. `exit` leaves the shell while keeping the
sandbox running. To stop it and remove its container:

```sh
sh sandbox/sandbox.sh stop
```

Repository files persist on the Mac; temporary files are lost when the
container stops. The Docker image is retained. No commit or push is performed.

Only this directory is shared with the container, with read/write access.
Changes made inside `/workspace` therefore modify files on the Mac.
The build context excludes repository content except for the Dockerfile.
The container runs with the Mac user's UID and GID (the Dockerfile also
specifies a non-root default user).

The root filesystem is read-only, with an in-memory `/tmp` (256 MB).
The container has no privileged mode, Linux capabilities or Docker socket.
Port 8080 is published only on `127.0.0.1` so the interface can be accessed
from this Mac. A Docker bridge network is used for the web server, unlike
the initial sandbox without a server; outbound connections are not blocked.
Resources are limited to 2 CPUs, 1 GB of RAM and 128 processes.
The initial build requires Internet access to pull the PHP image.
After changing the Dockerfile, run `stop` then `start` to rebuild.
PHP's built-in server is intended for local development.
