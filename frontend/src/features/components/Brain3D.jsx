import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadAtlas } from '../../lib/anatomicalBrain';
import BrainPlaceholder from './BrainPlaceholder';
import { useCoarsePointer, useMotionPrefs } from '../../landing/useMotionPrefs';
import { TONES, VISIBLE_CATEGORIES, regionByKey } from '../brainRegions';

/**
 * Loads the specimen once per session. `loadAtlas` already de-duplicates the
 * fetch and the Draco decode, so a second mount is instant.
 */
function useAtlas() {
  const [state, setState] = useState({ atlas: null, progress: 0, error: null });

  useEffect(() => {
    let live = true;
    loadAtlas((p) => live && setState((s) => (s.atlas ? s : { ...s, progress: p })))
      .then((atlas) => live && setState({ atlas, progress: 1, error: null }))
      .catch((error) => live && setState({ atlas: null, progress: 0, error }));
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/* Scratch objects, reused every frame so the render loop allocates nothing. */
const _projected = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _camDir = new THREE.Vector3();

/* Tones are module constants, so their THREE.Color equivalents can be built
   once and reused rather than allocated per mesh per frame. */
const COLOR_CACHE = new WeakMap();
function toneColors(tone) {
  let cached = COLOR_CACHE.get(tone);
  if (!cached) {
    cached = { color: new THREE.Color(tone.color), emissive: new THREE.Color(tone.emissive) };
    COLOR_CACHE.set(tone, cached);
  }
  return cached;
}

/**
 * The specimen itself.
 *
 * Highlighting works by retargeting each mesh's own material and easing toward
 * it, so a region change reads as tissue lighting up rather than as a hard
 * swap. Anchors for the annotation lines are the world-space centroids of the
 * two lit groups, projected to the canvas every frame — that is what keeps a
 * label tethered to its region while the visitor rotates the brain.
 */
function BrainModel({ atlas, regionKey, onAnchors, onExtents }) {
  const { camera, size } = useThree();

  /* Clone once: geometry is shared with the cached atlas, materials are not. */
  const built = useMemo(() => {
    if (!atlas) return null;

    const root = atlas.scene.clone(true);
    const meshes = [];
    const byLabel = new Map();

    root.traverse((object) => {
      if (!object.isMesh) return;
      const bx = object.userData.bx;

      if (!bx || !VISIBLE_CATEGORIES.has(bx.category)) {
        object.visible = false;
        return;
      }

      const tone = TONES[bx.category] ?? TONES.base;
      object.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(tone.color),
        emissive: new THREE.Color(tone.emissive),
        emissiveIntensity: tone.intensity,
        roughness: 0.82,
        metalness: 0.02,
        flatShading: false,
      });

      object.castShadow = false;
      object.receiveShadow = false;
      object.userData.tone = tone;
      meshes.push(object);

      const list = byLabel.get(bx.label);
      if (list) list.push(object);
      else byLabel.set(bx.label, [object]);
    });

    /*
     * Raw model axes are +X left, +Y superior, +Z anterior. Turning the group
     * -90° about Y maps (x, y, z) to (-z, y, x): anterior swings to screen
     * left and the lateral surface faces the camera, the orientation the
     * reference image shows. It is a rotation, not a mirror, so the anatomy
     * keeps its handedness.
     */
    root.rotation.y = -Math.PI / 2;
    root.updateMatrixWorld(true);

    /* Centre on the visible mass and normalise its size, since the source
       model is a whole-body export in metres with the brain up at head height. */
    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));
    const centre = box.getCenter(new THREE.Vector3());
    const scale = 2.6 / Math.max(...box.getSize(new THREE.Vector3()).toArray());

    const wrapper = new THREE.Group();
    wrapper.add(root);
    root.position.sub(centre);
    wrapper.scale.setScalar(scale);
    wrapper.updateMatrixWorld(true);

    /* Half-extents after scaling, for the camera fit below. */
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(scale / 2);

    return { wrapper, meshes, byLabel, extents: { x: half.x, y: half.y, z: half.z } };
  }, [atlas]);

  useEffect(() => {
    if (built && onExtents) onExtents(built.extents);
  }, [built, onExtents]);

  /* Retarget materials whenever the selected region changes. */
  const targets = useMemo(() => {
    if (!built) return null;
    const region = regionByKey(regionKey);
    const map = new Map();

    /*
     * Centroids are accumulated per hemisphere, in world space, and kept as a
     * list of candidates rather than averaged into one point.
     *
     * Every region here exists on both sides, and the midpoint of a left and a
     * right structure falls in the middle of the brain — inside the mass,
     * nowhere near the tissue being named. Keeping the sides apart lets the
     * render loop tether the label to whichever copy is facing the viewer.
     *
     * They are stable because the specimen never moves; only the camera does.
     */
    const assign = (structures, tone) => {
      const sides = new Map();
      structures.forEach((label) => {
        (built.byLabel.get(label) ?? []).forEach((mesh) => {
          map.set(mesh, tone);
          mesh.updateWorldMatrix(true, false);
          const side = mesh.userData.bx?.side ?? 'median';
          const bucket = sides.get(side) ?? { sum: new THREE.Vector3(), count: 0 };
          bucket.sum.add(new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()));
          bucket.count += 1;
          sides.set(side, bucket);
        });
      });
      return [...sides.values()].map((b) => b.sum.divideScalar(b.count));
    };

    const focus = assign(region.focus.structures, TONES.focus);
    const reference = assign(region.reference.structures, TONES.reference);
    return { map, focus, reference };
  }, [built, regionKey]);

  useFrame((_, delta) => {
    if (!built || !targets) return;

    /* Ease each material toward its target; ~6/sec is quick but not abrupt. */
    const k = 1 - Math.exp(-6 * delta);
    built.meshes.forEach((mesh) => {
      const tone = targets.map.get(mesh) ?? mesh.userData.tone;
      const { color, emissive } = toneColors(tone);
      const material = mesh.material;
      material.color.lerp(color, k);
      material.emissive.lerp(emissive, k);
      material.emissiveIntensity += (tone.intensity - material.emissiveIntensity) * k;
    });

    if (!onAnchors) return;

    /*
     * Project the two centroids into canvas pixels for the DOM annotation
     * layer. The specimen never moves — OrbitControls orbits the camera, not
     * the object — so the centroids are fixed world points and only the
     * projection changes.
     *
     * `visible` approximates occlusion without raycasting 190 meshes twice a
     * frame: the brain is roughly convex about its centre, so a centroid whose
     * outward direction points away from the camera is behind the mass.
     */
    camera.getWorldDirection(_camDir);
    const project = (candidates) => {
      if (!candidates || !candidates.length) return null;

      /* Tether to the copy nearest the camera: the one the viewer can see. */
      let point = candidates[0];
      let nearest = Infinity;
      for (const candidate of candidates) {
        const distance = candidate.distanceToSquared(camera.position);
        if (distance < nearest) {
          nearest = distance;
          point = candidate;
        }
      }

      const facing = _dir.copy(point).normalize().dot(_camDir);
      _projected.copy(point).project(camera);
      return {
        x: (_projected.x * 0.5 + 0.5) * size.width,
        y: (-_projected.y * 0.5 + 0.5) * size.height,
        visible: _projected.z < 1 && facing < 0.25,
      };
    };

    onAnchors({ focus: project(targets.focus), reference: project(targets.reference) });
  });

  if (!built) return null;
  return <primitive object={built.wrapper} />;
}

/**
 * Frames the specimen for whatever shape the canvas happens to be.
 *
 * A fixed camera distance only suits one aspect ratio: the same distance that
 * frames a wide desktop canvas crops the brain left and right on a phone,
 * where the horizontal field of view is much narrower. This solves for the
 * distance that satisfies both axes, keeping whatever direction the visitor
 * has rotated to. On touch screens it also bounds pinch-zoom around that
 * distance.
 */
function FitCamera({ extents, zoomable }) {
  const { camera, size, controls } = useThree();

  useEffect(() => {
    if (!extents || !size.height) return;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (size.width / size.height));
    /* The padding is not just breathing room: the extents are axis-aligned
       for the starting pose, and the specimen turns. 1.28 keeps it clear of
       the edges through a full rotation without pushing it so far back that
       it stops being the centre of the page. */
    const distance =
      Math.max(extents.y / Math.tan(vFov / 2), extents.x / Math.tan(hFov / 2)) * 1.28;

    camera.position.setLength(distance);
    camera.updateProjectionMatrix();
    if (controls) {
      /* Where pinch-zoom is on (touch screens), it is bounded around the
         fitted distance: close enough to read the folds, never so close the
         brain fills the canvas, never so far it gets lost. */
      controls.minDistance = zoomable ? distance * 0.72 : 0;
      controls.maxDistance = zoomable ? distance * 1.3 : Infinity;
      controls.update();
    }
  }, [camera, controls, extents, zoomable, size.width, size.height]);

  return null;
}

/**
 * Auto-rotation that yields to the visitor: it spins gently until the first
 * drag, then stays where it was left and only drifts again after a pause.
 */
function useIdleRotation(idleMs = 2600) {
  const controls = useRef();
  const lastInteraction = useRef(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      if (!lastInteraction.current) return;
      setAuto(Date.now() - lastInteraction.current > idleMs);
    }, 400);
    return () => clearInterval(id);
  }, [idleMs]);

  return {
    ref: controls,
    autoRotate: auto,
    onStart: () => {
      lastInteraction.current = Date.now();
      setAuto(false);
    },
    onEnd: () => {
      lastInteraction.current = Date.now();
    },
  };
}

function Rig({ still }) {
  /* A touch of drift on the key light so rotating the model reveals shape
     rather than a flat wash. Cheap, and it reads as a studio setup. */
  const key = useRef();
  useFrame(({ clock }) => {
    if (!key.current || still) return;
    const t = clock.getElapsedTime() * 0.25;
    key.current.position.set(3.2 + Math.sin(t) * 0.6, 4.4, 3.6 + Math.cos(t) * 0.6);
  });

  return (
    <>
      {/* Kept deliberately contrasty. A flat, evenly lit specimen loses its
          gyri and sulci entirely and starts to read as a plastic toy; the
          folds only show up when one light clearly dominates. */}
      <ambientLight intensity={0.38} color="#ffffff" />
      <hemisphereLight intensity={0.45} color="#ffffff" groundColor="#c3d3ee" />
      <directionalLight ref={key} position={[3.2, 4.4, 3.6]} intensity={1.7} color="#fff3de" />
      <directionalLight position={[-4, 1.2, 2.4]} intensity={0.5} color="#cfe0ff" />
      <directionalLight position={[0, -2.6, -3.2]} intensity={0.42} color="#e9d9ff" />
    </>
  );
}

/**
 * The interactive specimen: drag to rotate.
 *
 * Pan is always off, and so is zoom with a mouse: a wheel over the canvas
 * would hijack the page scroll, and with either it is easy to leave the brain
 * half out of frame with no obvious way back. On a touch screen pinch-zoom is
 * on, bounded tightly around the fitted framing (see FitCamera).
 *
 * On a phone the canvas renders at no more than 1.5x device pixels — the
 * difference from 2x is invisible at that size, and it is the largest single
 * cost of drawing the specimen. Reduced motion stops the auto-rotation and
 * the drifting key light.
 */
export default function Brain3D({ regionKey, onAnchors, onLoaded }) {
  const idle = useIdleRotation();
  const { reduce, compact } = useMotionPrefs();
  const coarse = useCoarsePointer();
  const [extents, setExtents] = useState(null);
  const { atlas, progress, error } = useAtlas();

  useEffect(() => {
    if (atlas && onLoaded) onLoaded(true);
  }, [atlas, onLoaded]);

  return (
    <>
    <Canvas
      className="!absolute inset-0"
      dpr={compact ? [1, 1.5] : [1, 2]}
      camera={{ position: [0.2, 0.55, 4.4], fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.12;
      }}
    >
      <Rig still={reduce} />
      {atlas && (
        <BrainModel
          atlas={atlas}
          regionKey={regionKey}
          onAnchors={onAnchors}
          onExtents={setExtents}
        />
      )}
      <OrbitControls
        ref={idle.ref}
        makeDefault
        enablePan={false}
        /* Pinch-zoom on touch only; FitCamera sets its limits. */
        enableZoom={coarse}
        enableDamping
        dampingFactor={0.075}
        rotateSpeed={0.6}
        /* Stop short of the poles: looking straight down the vertex of the
           brain is disorienting and there is nothing to read there. */
        minPolarAngle={Math.PI * 0.16}
        maxPolarAngle={Math.PI * 0.86}
        autoRotate={idle.autoRotate && !reduce}
        autoRotateSpeed={0.45}
        onStart={idle.onStart}
        onEnd={idle.onEnd}
      />
      {/* After OrbitControls, so `controls` is already the default. */}
      <FitCamera extents={extents} zoomable={coarse} />
    </Canvas>
    {(!atlas || error) && <BrainPlaceholder progress={progress} error={error} />}
    </>
  );
}

