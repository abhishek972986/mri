# Attribution and third-party licences

## 3D anatomical brain model

`frontend/public/models/brain.glb` and `frontend/public/models/brain-manifest.json`

Obtained from **[brainproject](https://github.com/itayinbarr/brainproject)** by
Itay Inbar (`brain-atlas/models/`), which derives the geometry from:

- **Z-Anatomy** — <https://www.z-anatomy.com/> · <https://github.com/Z-Anatomy>
- **BodyParts3D**, © The Database Center for Life Science (DBCLS)

**Licence: Creative Commons Attribution-ShareAlike 4.0 International
(CC BY-SA 4.0)** — <https://creativecommons.org/licenses/by-sa/4.0/>

This carries two obligations that apply to anyone redistributing this project:

1. **Attribution.** Credit must be kept. It is rendered in the 3D viewer itself
   (`frontend/src/components/BrainViewer.jsx`, footer credit line) as well as
   here, and must not be removed.
2. **ShareAlike.** The model, and any adapted version of it, must be distributed
   under CC BY-SA 4.0. This applies to the asset and its derivatives — not to
   the rest of this project's source code, which is separate and independently
   licensed. If you export, re-mesh, decimate, or otherwise modify `brain.glb`,
   the result stays CC BY-SA 4.0.

No modification has been made to `brain.glb`. It is loaded as published and
transformed only at runtime (translated, rotated and scaled into the viewer's
coordinate frame); nothing is written back.

## Rendering constants derived from brainproject

`frontend/src/lib/anatomicalBrain.js`

The `brainproject` application code is **Apache License 2.0**, © Itay Inbar.
No file from it is vendored here, but this project's integration module
**transcribes rendering constants and setup from its `brain-atlas/scene.js`**
so the specimen renders as its author intended rather than as this project
would otherwise have guessed:

- the 12-category colour palette (from `brain-atlas/data.js`)
- per-category emissive factors (`CAT_EMISS`), shading (`CAT_SHADE`),
  opacity caps (`MAX_OPACITY`) and the glossy-structure set (`VESSEL`)
- `MeshStandardMaterial` parameters — roughness, metalness, side, depth-write
- the four-light rig and hemisphere light: colours, intensities, positions
- renderer tone mapping, exposure and clear colour; camera field of view
- the default visible layers (cortex, cerebellum, brainstem), from `app.jsx`

Under Apache 2.0 §4 this constitutes a Derivative Work in part, and the
attribution above is retained accordingly. Points where this project
deliberately departs are marked `DIVERGES` in the source with the reason —
principally the coordinate frame (the specimen is mapped into the patient's RAS
millimetre frame rather than the original's Y-up stage) and the default cortex
opacity (lesions sit inside the brain, so an opaque cortex would hide them).

## Draco decoder

`frontend/public/draco/` — copied from the `three` npm package
(`three/examples/jsm/libs/draco/`). Google Draco, Apache License 2.0.

## three.js

MIT License, © 2010-2025 three.js authors.
