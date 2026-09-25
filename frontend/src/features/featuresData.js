import { Box, FileText, Layers, Target, Users, Zap } from 'lucide-react';

/**
 * Per-accent styling for the six cards.
 *
 * `line` is the connector colour and `anchor` is where that card's line should
 * meet the brain, given as a fraction of the stage box — see ConnectorOverlay.
 */
export const TONES = {
  rose: {
    title: 'text-[#E0484F]',
    card: 'from-[#FDF1F2] to-[#FDF7F6] border-[#F6DCDE]',
    icon: 'bg-[#FCE7E9] text-[#E0484F]',
    badge: 'bg-[#FBE0E2] text-[#D4474E]',
    line: '#E0484F',
  },
  violet: {
    title: 'text-[#7C5BD6]',
    card: 'from-[#F5F1FE] to-[#FAF8FE] border-[#E6DEF9]',
    icon: 'bg-[#EDE5FC] text-[#7C5BD6]',
    badge: 'bg-[#E9E0FB] text-[#7050CC]',
    line: '#7C5BD6',
  },
  mint: {
    title: 'text-[#12A06F]',
    card: 'from-[#EDF9F3] to-[#F5FBF8] border-[#D8EDE3]',
    icon: 'bg-[#E0F4EA] text-[#12A06F]',
    badge: 'bg-[#DCF1E7] text-[#0F8F63]',
    line: '#12A06F',
  },
  blue: {
    title: 'text-[#1F6FE0]',
    card: 'from-[#EFF5FE] to-[#F7FAFE] border-[#DCE8FA]',
    icon: 'bg-[#E3EEFD] text-[#1F6FE0]',
    badge: 'bg-[#DEEAFB] text-[#1A63CC]',
    line: '#1F6FE0',
  },
  pink: {
    title: 'text-[#DE3E8F]',
    card: 'from-[#FDF0F7] to-[#FDF7FA] border-[#F7DAEA]',
    icon: 'bg-[#FBE3F1] text-[#DE3E8F]',
    badge: 'bg-[#F9DDEC] text-[#CC3A83]',
    line: '#DE3E8F',
  },
  amber: {
    title: 'text-[#E07B2C]',
    card: 'from-[#FDF4EB] to-[#FDF9F4] border-[#F6E4CF]',
    icon: 'bg-[#FBEAD7] text-[#E07B2C]',
    badge: 'bg-[#F9E5CE] text-[#CC6F25]',
    line: '#E07B2C',
  },
};

/**
 * `anchor` is the point on the brain stage each connector runs to, in
 * fractions of the stage box. They are spread around the silhouette so six
 * lines can land without crossing each other.
 */
export const LEFT_FEATURES = [
  {
    number: '01',
    tone: 'rose',
    icon: Target,
    title: 'AI-Powered Detection',
    body: 'Accurately identifies abnormal regions such as tumors, lesions, and other anomalies in MRI scans.',
    anchor: { x: 0.3, y: 0.31 },
  },
  {
    number: '02',
    tone: 'violet',
    icon: Box,
    title: 'Interactive 3D Visualization',
    body: 'Explore brain regions in an interactive 3D model for better understanding.',
    anchor: { x: 0.21, y: 0.53 },
  },
  {
    number: '03',
    tone: 'mint',
    icon: Layers,
    title: 'Multi-Scan Comparison',
    body: 'Compare previous scans to track progress and analyze changes over time.',
    anchor: { x: 0.31, y: 0.74 },
  },
];

export const RIGHT_FEATURES = [
  {
    number: '04',
    tone: 'blue',
    icon: FileText,
    title: 'Automated Reports',
    body: 'Generate detailed, easy-to-understand reports with key findings and visualizations.',
    anchor: { x: 0.72, y: 0.3 },
  },
  {
    number: '05',
    tone: 'pink',
    icon: Zap,
    title: 'Faster Analysis',
    body: 'Reduce analysis time from hours to minutes, helping doctors make quicker decisions.',
    anchor: { x: 0.8, y: 0.52 },
  },
  {
    number: '06',
    tone: 'amber',
    icon: Users,
    title: 'Designed for Doctors',
    body: 'A simple, intuitive interface built for real-world clinical use.',
    anchor: { x: 0.71, y: 0.73 },
  },
];
