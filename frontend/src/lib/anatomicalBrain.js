import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The Brain Project specimen, imported faithfully.
 *
 * Source: https://github.com/itayinbarr/brainproject  (commit 2929e94)
 *   model     brain-atlas/models/brain.glb
 *   rendering brain-atlas/scene.js
 *   palette   brain-atlas/data.js
 *
 * Model licence: CC BY-SA 4.0 — Z-Anatomy, built on BodyParts3D © DBCLS,
 * with deep nuclei from CIT168 and Najdenovska 2018. See NOTICE.md.
 *
 * Every rendering constant below — palette, per-category emissive, shading,
 * opacity caps, roughness, light colours, positions and intensities, tone
 * mapping and exposure — is transcribed from their `scene.js` so the specimen
 * looks the way it does on their site rather than the way I would have guessed.
 * Where a value had to change for this application it is marked DIVERGES and
 * says why.
 *
 * 437 structures across 12 categories, each keeping its own mesh so that
 * per-structure picking stays possible, exactly as in the original.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE SYSTEMS
 *
 * The GLB is a whole-body Z-Anatomy export in METRES: the brain sits at
 * y ≈ 1.62, head height on a standing human. Its raw axes, derived from the
 * model's own geometry (left- vs right-sided structure centroids, cortex vs
 * brainstem, deep grey vs cerebellum) and consistent with the note in their
 * scene.js that "Z-Anatomy exports anterior toward +Z":
 *
 *     raw +X = LEFT        raw +Y = SUPERIOR       raw +Z = ANTERIOR
 *
 * This viewer works in millimetres on the patient's own RAS frame, centred on
 * their brain centroid:
 *
 *     view +X = RIGHT      view +Y = ANTERIOR      view +Z = SUPERIOR
 *
 * so the basis change is (x, y, z) -> (-x, z, y), times 1000 for m -> mm.
 *
 * The original instead spins the model 180° about Y and renders Y-up; this
 * takes the raw axes straight into the patient's frame, because the lesions
 * are already there and they are what must not move.
 * ---------------------------------------------------------------------------
 */

const MODEL_URL = '/models/brain.glb';
const DRACO_PATH = '/draco/';

/** Verbatim from brain-atlas/data.js — `window.BRAIN.palette`. */
export const PALETTE = {
  cortex: '#E7DEC9',
  white_matter: '#D7DDE8',
  deep_grey: '#B57BE0',
  diencephalon: '#7E8CF2',
  brainstem: '#E8B24A',
  cerebellum: '#F0894E',
  ventricles: '#3FC8D6',
  arteries: '#F05068',
  veins_sinuses: '#5078E8',
  cranial_nerves: '#D9D24A',
  meninges_dura: '#CC63CC',
  tracts: '#5FB6C9',
};

/** scene.js CAT_EMISS — per-subsystem self-illumination, so hues stay vivid
 *  against a dark stage. */
const CAT_EMISS = {
  cortex: 0.05, white_matter: 0.16, deep_grey: 0.44, diencephalon: 0.42,
  brainstem: 0.22, cerebellum: 0.12, ventricles: 0.54, arteries: 0.6,
  veins_sinuses: 0.5, cranial_nerves: 0.54, meninges_dura: 0.06, tracts: 0.5,
};

/** scene.js MAX_OPACITY — structures kept translucent even at full opacity. */
const MAX_OPACITY = { meninges_dura: 0.34, ventricles: 0.9 };

/** scene.js VESSEL — thin structures get a glossier roughness. */
const VESSEL = new Set(['arteries', 'veins_sinuses', 'cranial_nerves', 'tracts']);

/** The three solid masses that can stand between the camera and a lesion. */
const OCCLUDING_MASSES = new Set(['cortex', 'cerebellum', 'brainstem']);

/** scene.js CAT_SHADE — tones down the lightest masses so the cortex does not
 *  read as neon-white on a dark stage. */
const CAT_SHADE = { cortex: 0.62, white_matter: 0.8 };

/** Category order and labels from data.js, shortened as in app.jsx SHORT. */
export const CATEGORIES = [
  { key: 'cortex', label: 'Cortex', count: 128 },
  { key: 'cerebellum', label: 'Cerebellum', count: 33 },
  { key: 'brainstem', label: 'Brainstem', count: 30 },
  { key: 'deep_grey', label: 'Deep grey', count: 23 },
  { key: 'diencephalon', label: 'Diencephalon', count: 41 },
  { key: 'ventricles', label: 'Ventricles', count: 7 },
  { key: 'white_matter', label: 'White matter', count: 9 },
  { key: 'tracts', label: 'Tracts', count: 54 },
  { key: 'arteries', label: 'Arteries', count: 48 },
  { key: 'veins_sinuses', label: 'Sinuses', count: 17 },
  { key: 'cranial_nerves', label: 'Nerves', count: 44 },
  { key: 'meninges_dura', label: 'Dura & falx', count: 3 },
].map((c) => ({ ...c, color: PALETTE[c.key] }));

/** app.jsx: layers start as cortex + cerebellum + brainstem. */
export const DEFAULT_LAYERS = ['cortex', 'cerebellum', 'brainstem'];

/**
 * DIVERGES from the original, which opens with an opaque cortex (cortexOpacity
 * = 1) and expects you to peel inward. Here the finding is *inside* the brain,
 * so an opaque cortex would hide the thing the page exists to show. This is
 * their own cortexOpacity control, set to roughly the value their own
 * "Vasculature" preset uses (0.12) when it needs to see through the surface.
 */
export const DEFAULT_CORTEX_OPACITY = 0.18;

export const ATTRIBUTION = {
  text: 'Brain specimen: Z-Anatomy / BodyParts3D (DBCLS) via itayinbarr/brainproject — CC BY-SA 4.0',
  href: 'https://github.com/itayinbarr/brainproject',
};

function shade(category, hex) {
  const color = new THREE.Color(hex || '#cccccc');
  if (CAT_SHADE[category]) color.multiplyScalar(CAT_SHADE[category]);
  return color;
}

// One fetch and one Draco decode for the whole app: the GLB is 4.65 MB and
// switching studies must not re-download it.
let loadPromise = null;

/**
 * Fetch and decode the specimen. Cached after the first call.
 *
 * Returns the parsed scene plus the bounding box of the *core* structures.
 * Core is the original's own `bx_core` flag (271 of 437 nodes): the brain
 * proper, excluding the nerves and vessels that descend well below it. Their
 * scene.js centres on exactly this, and centring on anything else would sit
 * the brain far off-centre.
 */
export function loadAtlas(onProgress) {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    draco.setDecoderConfig({ type: 'wasm' });

    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const gltf = await new Promise((resolve, reject) => {
      loader.load(MODEL_URL, resolve, (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      }, reject);
    });
    draco.dispose();

    // Node `extras` carry the metadata (bx_cat, bx_id, bx_label, bx_side,
    // bx_core) and GLTFLoader copies them onto userData. Reading them from the
    // mesh is what the original does, and it is sturdier than matching the
    // manifest on node names — several of those carry stray leading spaces.
    const structures = [];
    const counts = {};

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const extras = extrasOf(object);
      const category = extras.bx_cat || 'other';

      object.userData.bx = {
        id: extras.bx_id ?? null,
        category,
        label: extras.bx_label ?? object.name,
        side: extras.bx_side ?? 'median',
        core: extras.bx_core === 1 || extras.bx_core === true,
      };

      counts[category] = (counts[category] || 0) + 1;
      structures.push(object.userData.bx);
    });

    const coreBounds = new THREE.Box3();
    let anyCore = false;
    gltf.scene.traverse((object) => {
      if (object.isMesh && object.userData.bx?.core) {
        coreBounds.expandByObject(object);
        anyCore = true;
      }
    });
    if (!anyCore) coreBounds.setFromObject(gltf.scene);

    return { scene: gltf.scene, coreBounds, structures, counts };
  })().catch((error) => {
    loadPromise = null;             // allow a failed load to be retried
    throw error;
  });

  return loadPromise;
}

/**
 * Build a scene-ready specimen fitted to one patient's brain bounds.
 *
 * `patientBounds` is the viewer-space box of the patient's own segmented brain
 * ({min, max} in mm, already centred on their brain centroid). The specimen is
 * translated and anisotropically scaled to fill it.
 *
 * That fit is 6 parameters — translation and per-axis scale — so the specimen is
 * a plausible anatomical *reference* at this patient's brain size, not a model
 * of their anatomy. Use the patient-surface view when their true shape matters.
 */
export function createAnatomicalBrain(atlas, patientBounds) {
  // Geometry is shared with the cached atlas; materials are not, so two viewers
  // can show different opacities without fighting over one material.
  const group = atlas.scene.clone(true);
  const byCategory = new Map();
  const materials = [];

  group.traverse((object) => {
    if (!object.isMesh) return;
    const bx = object.userData.bx;
    if (!bx) return;

    const category = bx.category;
    const base = shade(category, PALETTE[category]);
    const emissive = CAT_EMISS[category] ?? 0.06;

    // Transcribed from scene.js.
    const material = new THREE.MeshStandardMaterial({
      color: base.clone(),
      roughness: VESSEL.has(category) ? 0.5 : 0.82,
      metalness: 0.0,
      transparent: true,
      opacity: 1,
      emissive: base.clone().multiplyScalar(emissive),
      side: category === 'meninges_dura' ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: true,
    });

    object.material = material;
    object.userData.baseColor = base.clone();
    object.userData.baseEmiss = emissive;
    object.userData.maxOpacity = MAX_OPACITY[category] ?? 1;
    materials.push(material);

    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(object);
  });

  // Set the matrix directly rather than applyMatrix4, which would decompose it
  // into position/quaternion/scale. The fit carries a per-axis scale combined
  // with an axis permutation; assigning it avoids relying on decompose to
  // round-trip that exactly.
  const fit = computeFit(atlas.coreBounds, patientBounds);
  group.matrixAutoUpdate = false;
  group.matrix.copy(fit);
  group.updateMatrixWorld(true);

  const applyOpacity = (mesh, opacity) => {
    const capped = Math.min(mesh.userData.maxOpacity ?? 1, opacity);
    mesh.material.opacity = capped;
    // scene.js: opaque surfaces write depth, translucent ones must not, or they
    // occlude whatever sits behind them in draw order.
    mesh.material.depthWrite = capped >= 0.98;
    mesh.visible = capped > 0.012 && mesh.userData.layerOn !== false;
  };

  const api = {
    group,
    byCategory,
    fitMatrix: fit,

    setLayerVisible(category, visible) {
      for (const mesh of byCategory.get(category) ?? []) {
        mesh.userData.layerOn = visible;
        mesh.visible = visible && mesh.material.opacity > 0.012;
      }
    },

    setCategoryOpacity(category, opacity) {
      for (const mesh of byCategory.get(category) ?? []) applyOpacity(mesh, opacity);
    },

    /**
     * Dim the solid masses that stand between the camera and the lesions.
     *
     * This generalises the original's `cortexOpacity` control: there, only the
     * cortex needed thinning to reveal vessels beneath it. Here a lesion can
     * sit in the cerebellum or the brainstem just as easily, so all three
     * occluding masses follow the slider. The small interior structures keep
     * their own opacity — they are what the reader is trying to see past the
     * shell, and fading them too would defeat the purpose.
     */
    setShellOpacity(opacity) {
      for (const [category, meshes] of byCategory) {
        const target = OCCLUDING_MASSES.has(category) ? opacity : 1;
        for (const mesh of meshes) applyOpacity(mesh, target);
      }
    },

    dispose() {
      materials.forEach((material) => material.dispose());
      // Geometry belongs to the cached atlas and is deliberately not disposed.
    },
  };

  for (const { key } of CATEGORIES) api.setLayerVisible(key, DEFAULT_LAYERS.includes(key));
  return api;
}

/**
 * The lighting rig from scene.js, rotated into this viewer's frame.
 *
 * Their stage is Y-up with the model turned 180° about Y, so their scene axes
 * are (+X right, +Y superior, +Z posterior). This viewer is (+X right,
 * +Y anterior, +Z superior), so a light of theirs at (x, y, z) belongs at
 * (x, -z, y) here. Directional lights only carry a direction, so the specimen
 * ends up lit from exactly the same angles relative to its own anatomy.
 */
export function createLights() {
  const lights = [];

  const hemi = new THREE.HemisphereLight(0xc6d2ff, 0x14171f, 0.5);
  hemi.position.set(0, 0, 1);            // sky toward superior, not toward +Y
  lights.push(hemi);

  const rig = [
    { color: 0xffffff, intensity: 1.05, at: [4, 6.5, 7] },     // key
    { color: 0xaebfff, intensity: 0.34, at: [-6, 1, 3] },      // fill
    { color: 0x8ee0ff, intensity: 0.80, at: [-3, 3, -8] },     // cool rim
    { color: 0xff9bb6, intensity: 0.30, at: [5, -2, -6] },     // warm rim
  ];

  for (const { color, intensity, at } of rig) {
    const light = new THREE.DirectionalLight(color, intensity);
    const [x, y, z] = at;
    light.position.set(x, -z, y);
    lights.push(light);
  }

  return lights;
}

/** Renderer settings from scene.js, so the palette lands as it was tuned. */
export function applyRendererSettings(renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 0.95;
}

/** Camera field of view from scene.js. */
export const CAMERA_FOV = 38;

function extrasOf(object) {
  if (object.userData && object.userData.bx_cat != null) return object.userData;
  if (object.parent?.userData && object.parent.userData.bx_cat != null) return object.parent.userData;
  return object.userData || {};
}

/**
 * Matrix taking raw model space (metres, X=left/Y=superior/Z=anterior) into
 * viewer space (millimetres, X=right/Y=anterior/Z=superior), scaled so the core
 * structures fill the patient's brain bounding box.
 */
function computeFit(coreBounds, patientBounds) {
  const centre = coreBounds.getCenter(new THREE.Vector3());
  const size = coreBounds.getSize(new THREE.Vector3());

  // Core extent expressed in viewer axes, in millimetres.
  const modelSizeView = new THREE.Vector3(
    size.x * 1000,        // left-right          -> viewer X
    size.z * 1000,        // posterior-anterior  -> viewer Y
    size.y * 1000,        // inferior-superior   -> viewer Z
  );

  let scale = new THREE.Vector3(1, 1, 1);
  let offset = new THREE.Vector3(0, 0, 0);

  if (patientBounds?.min && patientBounds?.max) {
    const min = new THREE.Vector3().fromArray(patientBounds.min);
    const max = new THREE.Vector3().fromArray(patientBounds.max);
    const patientSize = new THREE.Vector3().subVectors(max, min);

    // A degenerate axis (a single-slice or corrupt mask) must not flatten the
    // specimen; fall back to life size on any axis that looks wrong.
    scale.set(
      patientSize.x > 1 && modelSizeView.x > 0 ? patientSize.x / modelSizeView.x : 1,
      patientSize.y > 1 && modelSizeView.y > 0 ? patientSize.y / modelSizeView.y : 1,
      patientSize.z > 1 && modelSizeView.z > 0 ? patientSize.z / modelSizeView.z : 1,
    );
    offset.addVectors(min, max).multiplyScalar(0.5);
  }

  const translate = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
  const basis = new THREE.Matrix4().set(
    -1000, 0, 0, 0,        // viewer X (right)    = -raw X (left),  m -> mm
    0, 0, 1000, 0,         // viewer Y (anterior) =  raw Z
    0, 1000, 0, 0,         // viewer Z (superior) =  raw Y
    0, 0, 0, 1,
  );
  const scaleMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
  const offsetMatrix = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);

  return offsetMatrix.multiply(scaleMatrix).multiply(basis).multiply(translate);
}
