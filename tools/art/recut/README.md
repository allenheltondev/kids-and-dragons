# Bigfoot base recuts

Run a single tier from the repository root:

```powershell
python tools/art/recut/bigfoot.py bigfoot/sworn --texture C:/path/coat-fur-texture.png
./tools/art/recut/review.ps1 bigfoot/sworn
python tools/art/recut/evidence.py bigfoot/sworn
```

Only the four Bigfoot base tiers are supported. Class assets are not written.
Requires Pillow, NumPy and SciPy. The shared ImageGen material is retained locally outside git at
`art/recut/bigfoot/fledgling/coat-fur-texture.png`; pass `--texture` when it
is stored elsewhere. Its prompt and provenance are recorded in PR #132. Missing material
stops before writing assets; it never silently substitutes another texture.

`bigfoot-traces.json` records the new tiers' individually traced faces, hair,
limbs and torso contours. Pinned joints are read from each set's `joints.json`;
the cutter never changes them. Visible approved RGB and outer alpha are
preserved. The receiving part's own coat supplies the hidden value field,
with the generated material supplying fine directional texture. The torso
ends at its own contour, with its own outline. Arm outlines travel with arms.
Hidden pixels are opaque. Detached trace fragments are assigned to connected
anatomical neighbours without dropping approved pixels.

The review runner requires the real config's underpaint to be 0 and runs A-H
in order, using `python` directly for Python checks on Windows. Existing Node
checks call their own Python runtime. It builds rigs only through
`npm run art:rig:build`. Any nonzero check stops the runner.

Evidence, masks, frames, sheets and logs are local under `art/recut/<set>/`.
They belong in PR attachments and description, never in git. The read-only
`evidence.py` records main/current band and joint measurements, visible RGB,
hidden alpha, SHA-256 hashes and opaque component counts. Exceptions are
reviewed sidecars; no tool writes or relaxes them.
