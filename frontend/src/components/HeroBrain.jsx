import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadAtlas } from '../lib/anatomicalBrain';

/**
 * The landing page hero: the real anatomical specimen rendered as a blue
 * x-ray-style volume with a single glowing lesion.
 *
 * This is the same Z-Anatomy GLB the dashboard viewer uses, through the same
 * cached `loadAtlas()`, so visiting the landing page warms the model for the
 * dashboard and neither pays for it twice.
 *
 * The translucent look is a Fresnel shader rather than a plain transparent
 * material: opacity that rises at grazing angles makes silhouette edges and
 * folded sulci read clearly while flat faces stay see-through, which is what
 * gives medical x-ray renders their depth. A uniformly transparent mesh just
 * looks like fog.
 */

const LESION_COLOR = new THREE.Color('#ff3a35');

// Right temporal lobe, in the specimen's own fitted frame (mm, +X right,
// +Y anterior, +Z superior). Matches the "Right Temporal Lobe" stat card.
const LESION_POSITION = new THREE.Vector3(44, 6, -18);
const LESION_RADIUS = 7.5;

const xrayVertex = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const xrayFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uBase;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Rim term: 0 face-on, 1 at grazing angles.
    float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
    float f = pow(clamp(rim, 0.0, 1.0), uPower);
    float alpha = uBase + f * uIntensity;
    // Brighten toward the rim, but keep the body saturated: on a light page the
    // silhouette has to darken the background, not add to it.
    vec3 c = mix(uColor, uColor + vec3(0.42), f);
    gl_FragColor = vec4(c, alpha);
  }
`;

function makeXrayMaterial(color, { base = 0.085, intensity = 0.4, power = 1.55 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uBase: { value: base },
      uIntensity: { value: intensity },
    },
    vertexShader: xrayVertex,
    fragmentShader: xrayFragment,
    transparent: true,
    depthWrite: false,            // so overlapping folds accumulate rather than clip
    // NOT additive: this page has a light background, and additive blending
    // drives every pixel toward white, which makes the specimen vanish.
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

// Categories that make up the visible hero silhouette. Vessels and nerves are
// left out: at this scale they read as noise rather than anatomy.
const HERO_CATEGORIES = new Set([
  'cortex', 'cerebellum', 'brainstem', 'white_matter', 'deep_grey', 'diencephalon',
]);

const CATEGORY_TINT = {
  cortex: '#3f8ae8',
  cerebellum: '#3379dc',
  brainstem: '#2d6fd4',
  white_matter: '#74acef',
  deep_grey: '#4f93e6',
  diencephalon: '#4f93e6',
};

export default function HeroBrain() {
  const mountRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [labelPos, setLabelPos] = useState(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    const disposables = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, mount.clientWidth / mount.clientHeight, 1, 5000);
    const root = new THREE.Group();
    scene.add(root);

    // Additive Fresnel needs no lighting, but the lesion is a lit material so it
    // reads as a solid mass inside a translucent shell.
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.PointLight(0xffd9dd, 2.4, 0, 2);
    key.position.set(60, 40, 40);
    scene.add(key);

    // --- lesion --------------------------------------------------------
    const lesionGroup = new THREE.Group();
    lesionGroup.position.copy(LESION_POSITION);
    root.add(lesionGroup);

    const lesionGeometry = new THREE.IcosahedronGeometry(LESION_RADIUS, 3);
    disposables.push(lesionGeometry);

    // Irregular surface: a perfect sphere reads as a marker, not a lesion.
    const pos = lesionGeometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const n = 1 + 0.16 * Math.sin(v.x * 0.55) * Math.cos(v.y * 0.5) + 0.1 * Math.sin(v.z * 0.7);
      v.multiplyScalar(n);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    lesionGeometry.computeVertexNormals();

    // Drawn after the specimen so it is not buried under thirty blended cortex
    // layers, but kept partly transparent so those layers still read across it.
    // Opaque-and-on-top looks like a sticker; behind-everything vanishes; this
    // is the only setting that reads as a hotspot glowing through tissue.
    const lesionMaterial = new THREE.MeshStandardMaterial({
      color: LESION_COLOR,
      emissive: LESION_COLOR.clone(),
      emissiveIntensity: 1.25,
      roughness: 0.35,
      metalness: 0.0,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      toneMapped: false,          // keep the hotspot from being rolled off
    });
    disposables.push(lesionMaterial);
    const lesionCore = new THREE.Mesh(lesionGeometry, lesionMaterial);
    lesionCore.renderOrder = 6;
    lesionGroup.add(lesionCore);

    // Two additive shells give the bloom around the lesion seen in the mockup.
    const glowMaterial = makeXrayMaterial('#ff5230', { base: 0.24, intensity: 0.42, power: 1.35 });
    disposables.push(glowMaterial);
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(LESION_RADIUS * 1.5, 2), glowMaterial);
    glow.renderOrder = 7;
    disposables.push(glow.geometry);
    lesionGroup.add(glow);

    const haloMaterial = makeXrayMaterial('#ff8a5c', { base: 0.1, intensity: 0.2, power: 1.1 });
    disposables.push(haloMaterial);
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(LESION_RADIUS * 2.15, 2), haloMaterial);
    halo.renderOrder = 8;
    disposables.push(halo.geometry);
    lesionGroup.add(halo);

    // --- specimen ------------------------------------------------------
    loadAtlas().then((atlas) => {
      if (disposed) return;

      const specimen = atlas.scene.clone(true);
      const box = new THREE.Box3();

      specimen.traverse((object) => {
        if (!object.isMesh) return;
        const category = object.userData.bx?.category;
        if (!HERO_CATEGORIES.has(category)) {
          object.visible = false;
          return;
        }
        const material = makeXrayMaterial(CATEGORY_TINT[category] ?? '#7fb4ff');
        disposables.push(material);
        object.material = material;
        object.renderOrder = 2;
      });

      // Centre on the core structures; the hero has no patient to fit to.
      const centre = atlas.coreBounds.getCenter(new THREE.Vector3());

      const translate = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
      const basis = new THREE.Matrix4().set(
        -1000, 0, 0, 0,        // viewer X (right)    = -raw X (left), m -> mm
        0, 0, 1000, 0,         // viewer Y (anterior) =  raw Z
        0, 1000, 0, 0,         // viewer Z (superior) =  raw Y
        0, 0, 0, 1,
      );
      specimen.matrixAutoUpdate = false;
      specimen.matrix.copy(basis.multiply(translate));
      specimen.updateMatrixWorld(true);

      root.add(specimen);

      // Frame on the VISIBLE structures only. Box3.expandByObject ignores the
      // `visible` flag, so measuring the whole specimen included the cranial
      // nerves and arteries running down to the spine, roughly tripling the
      // radius and leaving the brain a speck in the middle of the canvas.
      specimen.traverse((object) => {
        if (object.isMesh && object.visible) box.expandByObject(object);
      });
      if (box.isEmpty()) box.setFromObject(specimen);

      const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 100;
      const distance = radius * 3.05;
      camera.position.set(-distance * 0.9, distance * 0.36, distance * 0.17);

      setReady(true);
    }).catch(() => { /* hero is decorative; a failure must not break the page */ });

    // --- animation -----------------------------------------------------
    const projected = new THREE.Vector3();
    let frame;
    let t = 0;

    const animate = () => {
      frame = requestAnimationFrame(animate);
      t += 0.0045;

      // Slow turn around the superior axis, easing at the extremes so the
      // three-quarter view the mockup uses stays on screen most of the time.
      root.rotation.z = Math.sin(t) * 0.17;

      const pulse = 0.5 + 0.5 * Math.sin(t * 6.5);
      glowMaterial.uniforms.uBase.value = 0.22 + pulse * 0.12;
      haloMaterial.uniforms.uBase.value = 0.09 + pulse * 0.06;
      lesionMaterial.emissiveIntensity = 1.0 + pulse * 0.4;

      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);

      // Project the lesion to screen space so the HTML callout can track it.
      lesionGroup.getWorldPosition(projected);
      projected.project(camera);
      setLabelPos({
        x: (projected.x * 0.5 + 0.5) * 100,
        y: (-projected.y * 0.5 + 0.5) * 100,
        visible: projected.z < 1,
      });
    };
    animate();

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="hero-brain">
      <div ref={mountRef} className="hero-brain-canvas" />

      {!ready && <div className="hero-brain-loading"><span className="dot" /><span className="dot" /><span className="dot" /></div>}

      {ready && labelPos?.visible && (
        <div
          className="lesion-callout"
          style={{ left: `${labelPos.x}%`, top: `${labelPos.y}%` }}
        >
          <span className="callout-line" />
          <span className="callout-chip">
            <i className="callout-dot" />
            Detected Lesion
          </span>
        </div>
      )}
    </div>
  );
}
