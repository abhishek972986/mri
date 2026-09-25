/**
 * Cortical region groupings for the features page.
 *
 * The labels are the `bx_label` values carried by the specimen in
 * /public/models/brain.glb (Z-Anatomy via itayinbarr/brainproject, CC BY-SA
 * 4.0 — see NOTICE.md). Each one names a real structure that exists twice in
 * the model, once per hemisphere, so matching on the label highlights both
 * sides at once.
 *
 * Grouping by label rather than by a hand-placed sphere is what lets the
 * highlight sit *on* the anatomy: the glow follows the gyri and sulci of the
 * actual mesh, and stays correct from every angle the visitor rotates to.
 */

/** Frontal cortex in front of the motor strip. */
const PREFRONTAL = [
  'Superior frontal gyrus',
  'Superior frontal sulcus',
  'Middle frontal gyrus',
  'Inferior frontal sulcus',
  'Opercular part of inferior frontal gyrus',
  'Triangular part of inferior frontal gyrus',
  'Orbital part of inferior frontal gyrus',
  'Orbital gyri',
  'Orbital gyri (Frontomarginal gyrus and sulcus)',
  'Orbital sulci (H-shaped orbital sulci)',
  'Orbital sulci (Lateral Orbital sulcus)',
  'Straight gyrus (Gyrus rectus)',
  'Transverse frontopolar gyrus and sulcus',
  'Olfactory sulcus',
];

/** Prefrontal plus the precentral (motor) strip. */
const FRONTAL = [
  ...PREFRONTAL,
  'Precentral gyrus',
  'Precentral sulcus (Superior part)',
  'Precentral sulcus (inferior part)',
  'Paracentral gyrus and sulcus',
  'Paracentral sulcus',
];

const TEMPORAL = [
  'Superior temporal gyrus (Lateral part)',
  'Superior temporal sulcus',
  'Middle temporal gyrus',
  'Inferior temporal gyrus',
  'Inferior temporal sulcus',
  'Temporal pole',
  'Temporal plane',
  'Transverse temporal gyri',
  'Lateral occipitotemporal gyrus',
  'Medial occipitotemporal gyrus (Parahippocampal)',
  'Occipitotemporal sulcus (Lateral part)',
  'Collateral sulcus',
  'Posterior transverse collateral sulcus',
];

const PARIETAL = [
  'Postcentral gyrus',
  'Postcentral sulcus',
  'Superior parietal lobule',
  'Supramarginal gyrus',
  'Angular gyrus',
  'Intraparietal sulcus',
  'Subparietal sulcus',
  'Precuneus',
  'Sulcus interm prim-Jensen',
  'Cingulate sulcus (Marginal part)',
];

/**
 * What the selector offers.
 *
 * `focus` is the area lit warm, as the region under analysis; `reference` is a
 * second area lit cool, standing in for unaffected tissue. Every option pairs
 * the two so the view always shows a contrast rather than a single glow, which
 * is the comparison the page is describing.
 */
export const REGIONS = [
  {
    key: 'cerebral-cortex',
    label: 'Cerebral Cortex',
    focus: { label: 'Prefrontal Cortex', note: 'Selected Region', structures: PREFRONTAL },
    reference: { label: 'Parietal Lobe', note: 'Healthy Region', structures: PARIETAL },
  },
  {
    key: 'frontal-lobe',
    label: 'Frontal Lobe',
    focus: { label: 'Frontal Lobe', note: 'Selected Region', structures: FRONTAL },
    reference: { label: 'Parietal Lobe', note: 'Healthy Region', structures: PARIETAL },
  },
  {
    key: 'temporal-lobe',
    label: 'Temporal Lobe',
    focus: { label: 'Temporal Lobe', note: 'Selected Region', structures: TEMPORAL },
    reference: { label: 'Parietal Lobe', note: 'Healthy Region', structures: PARIETAL },
  },
  {
    key: 'parietal-lobe',
    label: 'Parietal Lobe',
    focus: { label: 'Parietal Lobe', note: 'Selected Region', structures: PARIETAL },
    reference: { label: 'Temporal Lobe', note: 'Healthy Region', structures: TEMPORAL },
  },
];

export const DEFAULT_REGION = REGIONS[0].key;

export function regionByKey(key) {
  return REGIONS.find((r) => r.key === key) ?? REGIONS[0];
}

/** Categories kept in the render: the brain as the reference image shows it. */
export const VISIBLE_CATEGORIES = new Set(['cortex', 'cerebellum', 'brainstem']);

export const TONES = {
  /* Warm gold for the region under analysis, cool blue for healthy tissue. */
  focus: { color: '#E3A44A', emissive: '#FF9A2E', intensity: 0.3 },
  reference: { color: '#7FB0EC', emissive: '#3E8FF0', intensity: 0.26 },
  /* Light ivory base, the clay-like surface of a medical specimen render. */
  base: { color: '#E6D9BE', emissive: '#C9B99A', intensity: 0.05 },
  cerebellum: { color: '#DCCBAB', emissive: '#C0AE8C', intensity: 0.05 },
  brainstem: { color: '#D9C4A2', emissive: '#BFA986', intensity: 0.05 },
};
