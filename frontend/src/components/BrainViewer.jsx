import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ATTRIBUTION,
  CAMERA_FOV,
  CATEGORIES,
  DEFAULT_CORTEX_OPACITY,
  applyRendererSettings,
  createAnatomicalBrain,
  createLights,
  loadAtlas,
} from '../lib/anatomicalBrain';

/**
 * Interactive 3D brain and lesion viewer.
 *
 * Two brain surfaces are available and they answer different questions:
 *
 *   "anatomy"  The Z-Anatomy atlas — a real, structurally detailed brain, fitted
 *              to this patient's brain bounding box. Recognisable, and lets a
 *              lesion be read against cortex, cerebellum and brainstem. It is a
 *              normalised reference, NOT this patient's anatomy.
 *
 *   "patient"  The isosurface of the patient's own segmented brain. Genuinely
 *              theirs and exactly where the lesions are, but a smooth hull with
 *              no internal structure.
 *
 * Lesion geometry is identical in both: it always comes from the patient's scan
 * in their own millimetre frame. Only the surrounding reference changes.
 *
 * Orbit controls are implemented here rather than pulled from three's examples:
 * the app needs rotate and zoom and nothing else.
 */

const LESION_COLOR = 0xff4d4d;
const LESION_TB_COLOR = 0xffb347;
const SELECTED_COLOR = 0x4dd4ff;

const CHANGE_COLORS = {
  new: 0xff4d4d,
  resolved: 0x4ade80,
  persistent: 0xfacc15,
};

function buildGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.normals?.length === mesh.positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  }
  geometry.setIndex(mesh.indices);
  if (!mesh.normals?.length) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export default function BrainViewer({
  scene: scenePayload,
  mode = 'single',
  selectedLesionId = null,
  onSelectLesion,
  brainSurface = 'anatomy',
  brainOpacity = 1.0,
  visibleCategories = null,
  visibleChangeLayers = { new: true, resolved: true, persistent: true },
}) {
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [atlasState, setAtlasState] = useState({ status: 'idle', progress: 0, error: null });

  // --- renderer, camera, controls: created once ---------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    applyRendererSettings(renderer);          // their tone mapping and exposure
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV, mount.clientWidth / mount.clientHeight, 1, 6000,
    );

    // The Brain Project lighting rig, rotated into this viewer's frame.
    createLights().forEach((light) => scene.add(light));

    const root = new THREE.Group();
    scene.add(root);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const state = {
      renderer, scene, camera, root, raycaster, pointer,
      lesionMeshes: [], patientBrain: null, anatomy: null, changeMeshes: {},
      // Z-up orbit, not THREE.Spherical: that class measures phi from +Y, but
      // this scene is anatomical RAS where +Z is superior. Using it would orbit
      // around the anterior-posterior axis and the head would roll as it turned.
      // phi is measured from +Z (superior), theta is azimuth in the axial plane
      // from +X (right) toward +Y (anterior). Default is a right anterolateral
      // three-quarter view, slightly above the AC-PC plane.
      orbit: { radius: 420, theta: -1.0, phi: 1.25 },
      target: new THREE.Vector3(0, 0, 0),
      disposables: [],
      hoveredId: undefined,
    };
    stateRef.current = state;

    let dragging = false;
    let moved = 0;
    let last = { x: 0, y: 0 };

    const onPointerDown = (event) => {
      dragging = true;
      moved = 0;
      last = { x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (!dragging) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      last = { x: event.clientX, y: event.clientY };

      state.orbit.theta -= dx * 0.006;
      state.orbit.phi -= dy * 0.006;
      // Clamp off the poles, where the camera's up vector degenerates.
      state.orbit.phi = Math.max(0.05, Math.min(Math.PI - 0.05, state.orbit.phi));
    };

    const handleClick = () => {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(state.lesionMeshes, false);
      state.onSelect?.(hits.length ? hits[0].object.userData.lesionId : null);
    };

    const onPointerUp = (event) => {
      if (dragging && moved < 5) handleClick();
      dragging = false;
      try { renderer.domElement.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    };

    const onWheel = (event) => {
      event.preventDefault();
      state.orbit.radius = THREE.MathUtils.clamp(
        state.orbit.radius * (1 + Math.sign(event.deltaY) * 0.1), 60, 2000,
      );
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame;
    const animate = () => {
      frame = requestAnimationFrame(animate);

      // The scene is built in RAS millimetres, where +Z is superior, so the
      // camera's up vector is +Z and not three's default +Y.
      const { radius, theta, phi } = state.orbit;
      const sinPhi = Math.sin(phi);
      camera.up.set(0, 0, 1);
      camera.position.set(
        radius * sinPhi * Math.cos(theta),
        radius * sinPhi * Math.sin(theta),
        radius * Math.cos(phi),
      ).add(state.target);
      camera.lookAt(state.target);

      if (!dragging && state.lesionMeshes.length) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.lesionMeshes, false);
        const id = hits.length ? hits[0].object.userData.lesionId : null;
        if (id !== state.hoveredId) {
          state.hoveredId = id;
          state.onHover?.(hits.length ? hits[0].object.userData : null);
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      state.anatomy?.dispose();
      state.disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  // Keep the latest callbacks reachable from the animation loop without
  // tearing down the renderer whenever a parent re-renders.
  useEffect(() => {
    if (stateRef.current) {
      stateRef.current.onSelect = onSelectLesion;
      stateRef.current.onHover = setHovered;
    }
  }, [onSelectLesion]);

  // --- patient geometry: rebuilt only when the payload changes ------------
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !scenePayload) return;

    const { root, disposables } = state;
    // Remove only patient geometry; the anatomical model is managed separately
    // and must survive a change of study.
    for (const child of [...root.children]) {
      if (child !== state.anatomy?.group) root.remove(child);
    }
    disposables.forEach((d) => d.dispose?.());
    disposables.length = 0;
    state.lesionMeshes = [];
    state.changeMeshes = {};
    state.patientBrain = null;

    const track = (obj) => { disposables.push(obj); return obj; };

    if (scenePayload.brain) {
      const geometry = track(buildGeometry(scenePayload.brain));
      const material = track(new THREE.MeshPhongMaterial({
        color: 0x9fb4d8,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
        shininess: 12,
      }));
      const brain = new THREE.Mesh(geometry, material);
      brain.renderOrder = 3;
      state.patientBrain = brain;
      root.add(brain);
    }

    const addLesion = (entry, color) => {
      if (!entry?.mesh) return;
      const geometry = track(buildGeometry(entry.mesh));
      const material = track(new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.05,
        emissive: new THREE.Color(color).multiplyScalar(0.12),
      }));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      mesh.userData = { ...entry, lesionId: entry.lesion_id, baseColor: color };
      state.lesionMeshes.push(mesh);
      root.add(mesh);
    };

    if (mode === 'single') {
      (scenePayload.lesions || []).forEach((entry) => {
        addLesion(entry, entry.tb_typical_site ? LESION_TB_COLOR : LESION_COLOR);
      });
    } else {
      Object.entries(scenePayload.change || {}).forEach(([layer, meshData]) => {
        if (!meshData) return;
        const geometry = track(buildGeometry(meshData));
        const material = track(new THREE.MeshStandardMaterial({
          color: CHANGE_COLORS[layer] ?? 0xffffff,
          roughness: 0.4,
          transparent: true,
          opacity: 0.94,
        }));
        const object = new THREE.Mesh(geometry, material);
        object.renderOrder = 1;
        object.userData = { layer };
        state.changeMeshes[layer] = object;
        root.add(object);
      });
    }

    const radius = scenePayload.bounds_mm?.radius ?? 100;
    state.orbit.radius = radius * 3.6;
    state.target.set(0, 0, 0);
  }, [scenePayload, mode]);

  // --- anatomical atlas: fetched once, refitted per study ------------------
  useEffect(() => {
    if (brainSurface !== 'anatomy' || !scenePayload) return undefined;

    let cancelled = false;
    setAtlasState((prev) => (prev.status === 'ready' ? prev : { status: 'loading', progress: 0, error: null }));

    loadAtlas((progress) => {
      if (!cancelled) setAtlasState({ status: 'loading', progress, error: null });
    })
      .then((atlas) => {
        const state = stateRef.current;
        if (cancelled || !state) return;

        state.anatomy?.dispose();
        if (state.anatomy?.group) state.root.remove(state.anatomy.group);

        state.anatomy = createAnatomicalBrain(atlas, scenePayload.bounds_mm);
        state.root.add(state.anatomy.group);
        setAtlasState({ status: 'ready', progress: 1, error: null });
      })
      .catch((error) => {
        if (!cancelled) setAtlasState({ status: 'error', progress: 0, error: error.message });
      });

    return () => { cancelled = true; };
  }, [brainSurface, scenePayload]);

  // --- cheap updates ------------------------------------------------------
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    const showAnatomy = brainSurface === 'anatomy';
    if (state.anatomy?.group) state.anatomy.group.visible = showAnatomy;
    if (state.patientBrain) state.patientBrain.visible = brainSurface === 'patient';
  }, [brainSurface, atlasState.status, scenePayload]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.anatomy?.setShellOpacity(brainOpacity * DEFAULT_CORTEX_OPACITY);
    if (state.patientBrain) state.patientBrain.material.opacity = 0.12 * brainOpacity;
  }, [brainOpacity, atlasState.status, scenePayload]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state?.anatomy || !visibleCategories) return;
    for (const config of CATEGORIES) {
      state.anatomy.setLayerVisible(config.key, !!visibleCategories[config.key]);
    }
  }, [visibleCategories, atlasState.status, scenePayload]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.lesionMeshes.forEach((mesh) => {
      const selected = mesh.userData.lesionId === selectedLesionId;
      mesh.material.color.setHex(selected ? SELECTED_COLOR : mesh.userData.baseColor);
      mesh.material.emissive.setHex(selected ? 0x186a80 : 0x000000);
      mesh.scale.setScalar(selected ? 1.1 : 1);
    });
  }, [selectedLesionId, scenePayload]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    Object.entries(state.changeMeshes).forEach(([layer, mesh]) => {
      mesh.visible = visibleChangeLayers[layer] !== false;
    });
  }, [visibleChangeLayers, scenePayload, mode]);

  const legend = useMemo(() => (
    mode === 'single'
      ? [
          { color: '#ff4d4d', label: 'Lesion' },
          { color: '#ffb347', label: 'TB-typical site' },
          { color: '#4dd4ff', label: 'Selected' },
        ]
      : [
          { color: '#ff4d4d', label: 'New / enlarged' },
          { color: '#facc15', label: 'Persistent' },
          { color: '#4ade80', label: 'Resolved' },
        ]
  ), [mode]);

  return (
    <div className="viewer">
      <div ref={mountRef} className="viewer-canvas" />

      {brainSurface === 'anatomy' && atlasState.status === 'loading' && (
        <div className="viewer-overlay">
          <div>
            Loading anatomical brain model…
            <div className="load-track">
              <div className="load-fill" style={{ width: `${Math.round(atlasState.progress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {brainSurface === 'anatomy' && atlasState.status === 'error' && (
        <div className="viewer-overlay error">
          Could not load the anatomical model: {atlasState.error}
          <br />Switch to the patient surface to continue.
        </div>
      )}

      <div className="viewer-legend">
        {legend.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {hovered?.lesion_id != null && (
        <div className="viewer-tooltip">
          <strong>Lesion {hovered.lesion_id}</strong>
          <span>{hovered.side} {hovered.region}</span>
          <span>{hovered.volume_cm3?.toFixed(3)} cm³ · {hovered.max_diameter_mm?.toFixed(1)} mm</span>
        </div>
      )}

      <div className="viewer-footer">
        <span className="viewer-hint">Drag to rotate · scroll to zoom · click a lesion</span>
        {brainSurface === 'anatomy' && (
          <a className="viewer-credit" href={ATTRIBUTION.href} target="_blank" rel="noreferrer">
            {ATTRIBUTION.text}
          </a>
        )}
      </div>
    </div>
  );
}
