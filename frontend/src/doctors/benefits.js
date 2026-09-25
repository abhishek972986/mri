import { Brain, FileText, TrendingUp, Zap } from 'lucide-react';

/**
 * The four things the page promises a clinician.
 *
 * Wording is deliberate throughout: the system assists with analysis and
 * generates material for a doctor to read. It does not diagnose, and nothing
 * here should suggest it does.
 */
export const BENEFITS = [
  {
    icon: Zap,
    title: 'Faster, More Confident Decisions',
    body: 'Get AI-assisted analysis and clear visualizations to identify critical findings quickly.',
    icons: 'bg-[#E8F1FE] text-[#1677E8]',
    rule: 'bg-[#1677E8]',
    tint: 'group-hover:bg-[#F5F9FF]',
  },
  {
    icon: Brain,
    title: 'Interactive 3D Understanding',
    body: 'Explore affected brain regions in a detailed 3D model for better clinical interpretation.',
    icons: 'bg-[#E1F6F1] text-[#0FA28C]',
    rule: 'bg-[#0FA28C]',
    tint: 'group-hover:bg-[#F4FBF9]',
  },
  {
    icon: FileText,
    title: 'Comprehensive, Easy-to-Understand Reports',
    body: 'Receive structured AI-generated reports with key findings, measurements, and visual insights.',
    icons: 'bg-[#EFE9FD] text-[#7C5BD6]',
    rule: 'bg-[#7C5BD6]',
    tint: 'group-hover:bg-[#F8F6FE]',
  },
  {
    icon: TrendingUp,
    title: 'Track Progress Over Time',
    body: 'Compare multiple scans to analyze changes and monitor treatment response.',
    icons: 'bg-[#FDE8EC] text-[#E14A6B]',
    rule: 'bg-[#E14A6B]',
    tint: 'group-hover:bg-[#FEF6F8]',
  },
];
