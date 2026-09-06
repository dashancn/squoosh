# Corresponding source for the distributed HEIC worker

This directory accompanies `heic-to-1.5.2.worker.js`. It contains the preferred-form source and the exact application-side inputs needed to rebuild or replace that separable module worker.

## Components and pinned upstream identity

| Component | Version/tag commit                                  | Accompanying archive     | SHA-256                                                            | License                                                                        |
| --------- | --------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| heic-to   | 1.5.2 / `f37af866f9aa6212ddc84b67a279c9f2386aba4f`  | `heic-to-v1.5.2.tar.gz`  | `8beb13f9f09e444a2955a4e1f129f5a1458e15b6e7fd898ec38c857090296544` | LGPL-3.0                                                                       |
| libheif   | 1.22.2 / `763bc8bb87788d64d39ece623ceed988de12dc5b` | `libheif-v1.22.2.tar.gz` | `af30a8b32dfbc1dc86a7f0f55a53107dad35010a65ebf1feb468082e402b11e0` | library LGPL-3.0; see its `COPYING` for differently licensed examples/wrappers |
| libde265  | 1.0.16 / `7ba65889d3d6d8a0d99b5360b028243ba843be3a` | `libde265-1.0.16.tar.gz` | `b92beb6b53c346db9a8fae968d686ab706240099cdd5aff87777362d668b0de7` | library LGPL-3.0; see archive `COPYING` files                                  |

The libde265 file is the upstream release archive expected by libheif's `build-emscripten.sh`, not GitHub's auto-generated tag snapshot. All archives are shipped beside this document, so obtaining corresponding source does not depend on a mutable upstream service. Verify them with `sha256sum -c SHA256SUMS`.

## Exact distributed worker inputs

`rebuild/` contains verbatim copies of:

- `heic-to-worker-entry.mjs`: the custom module entry actually bundled;
- `build.mjs`: the converter build/configuration, including all esbuild options;
- `package.json` and exact `package-lock.json`;
- `rebuild-and-verify.mjs`: an offline rebuild and API/fixture verification script;
- `expected-worker.sha256`: the distributed worker's byte hash at packaging time.

The heic-to archive also contains the exact embedded generated `src/lib/libheif-without-unsafe-eval.js` used as input. Its SHA-256 is `356068bb64947a76f1490ee139b2cab52f62e5e60d1945413aed9ab94c09e754`.

## Rebuild the exact custom worker from shipped inputs

Prerequisites: Node.js 22 or newer and npm. No network is needed when the package cache or current checkout already contains the lockfile dependencies; otherwise `npm ci` obtains the exact integrity-pinned npm artifacts recorded in `package-lock.json`.

From this `third-party` directory:

```sh
cd rebuild
npm ci
node rebuild-and-verify.mjs
```

The script extracts the accompanying heic-to archive, checks all archive hashes, bundles `heic-to-worker-entry.mjs` with esbuild 0.25.4 using the published `build.mjs` options, and verifies exports plus decoding of the shipped HEIC fixture. On the maintained toolchain the generated worker is byte-identical to the distributed worker and its hash is compared. esbuild does not promise identical output across operating systems or future Node releases, so the overall process is not byte-for-byte reproducible on every toolchain; API and real-fixture functional verification remains authoritative when diagnosing such a mismatch.

To install/relink a modified LGPL library, rebuild `libheif-without-unsafe-eval.js` as below, replace the file at `heic-to-1.5.2/src/lib/libheif-without-unsafe-eval.js`, then run the custom worker rebuild. Replace the deployed `heic-to-1.5.2.worker.js` with the resulting `rebuild/out/heic-to-1.5.2.worker.js`. No Apache-licensed application source needs to be combined with the library; the app communicates with this independently replaceable module worker by messages.

## Rebuild the embedded libheif + libde265 JavaScript

Prerequisites used by upstream's script include Emscripten/emsdk, CMake, make, pkg-config, autoconf/automake/libtool, and LLVM tools. The upstream heic-to 1.5.2 release does not record the exact Emscripten SDK revision used to generate its committed JavaScript, so an independently regenerated low-level file is not claimed to be byte-identical. Complete source, build script, flags, and the actual generated preferred-form input used by our esbuild stage are all included.

```sh
mkdir low-level-build
cd low-level-build
tar -xzf ../libheif-v1.22.2.tar.gz
cp ../libde265-1.0.16.tar.gz .
mkdir buildjs
cd buildjs
LIBDE265_VERSION=1.0.16 USE_UNSAFE_EVAL=0 USE_WASM=0 \
  ../libheif-1.22.2/build-emscripten.sh ../libheif-1.22.2
```

This is the exact upstream configuration stated by heic-to 1.5.2 for the embedded artifact: `LIBDE265_VERSION=1.0.16`, `USE_UNSAFE_EVAL=0`, and `USE_WASM=0`. The libheif script supplies the remaining compiler/linker settings and disables unrelated codecs by default. Copy `low-level-build/buildjs/libheif.js` into the extracted heic-to source at `src/lib/libheif-without-unsafe-eval.js`, preserving its default export wrapper if the selected Emscripten version emits a differently named module.

## Notices and scope

Verbatim license texts are under `LICENSES/` and inside every complete source archive. The repository application's root `LICENSE` remains Apache-2.0. These materials document and enable replacement of the LGPL worker; they do not change the application's license and are not legal advice.
