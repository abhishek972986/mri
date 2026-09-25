import { motion } from 'framer-motion';
import WorkflowConnector from './WorkflowConnector';
import WorkflowStep from './WorkflowStep';
import AIAnalysisStep from './steps/AIAnalysisStep';
import DetectionStep from './steps/DetectionStep';
import ReportStep from './steps/ReportStep';
import UploadStep from './steps/UploadStep';
import VisualizationStep from './steps/VisualizationStep';
import { stagger } from '../../landing/motion';

const STEPS = [
  {
    number: '01',
    tone: 'navy',
    title: 'Upload MRI Scan',
    description: 'Upload your brain MRI scan (DICOM or standard image formats).',
    Visual: UploadStep,
  },
  {
    number: '02',
    tone: 'mint',
    title: 'AI Analysis',
    description: 'Our deep learning models analyze the scan to detect and segment abnormal regions.',
    Visual: AIAnalysisStep,
  },
  {
    number: '03',
    tone: 'rose',
    title: 'Detection & Segmentation',
    description:
      'AI identifies and highlights abnormal regions such as tumors, lesions, or other anomalies.',
    Visual: DetectionStep,
  },
  {
    number: '04',
    tone: 'violet',
    title: '3D Visualization',
    description:
      'View the detected regions in an interactive 3D brain model with accurate localization.',
    Visual: VisualizationStep,
  },
  {
    number: '05',
    tone: 'blue',
    title: 'Reports & Insights',
    description:
      'Get detailed AI-generated reports with findings, visualizations, and comparisons with previous scans.',
    Visual: ReportStep,
  },
];

/*
 * Placement in the tablet grid (md → xl): 01 → 02 on the first row, 03 → 04
 * on the second, 05 centred alone on the third. The grid has a narrow middle
 * column that holds the arrow between a row's two cards. Below md and from xl
 * the container is a flex column / row, and none of these classes apply.
 */
const TABLET_STEP = [
  'md:col-start-1 md:row-start-1',
  'md:col-start-3 md:row-start-1',
  'md:col-start-1 md:row-start-2',
  'md:col-start-3 md:row-start-2',
  'md:col-span-3 md:row-start-3 md:mx-auto md:w-[calc((100%-2.75rem)/2)] xl:mx-0 xl:w-auto',
];

/* Connectors after steps 01 and 03 sit inside a row; the ones after 02 and 04
   would have to cross from the end of one row to the start of the next, so
   the tablet grid drops them and the numbering carries the order. */
const TABLET_CONNECTOR = [
  'md:col-start-2 md:row-start-1',
  'md:hidden xl:flex',
  'md:col-start-2 md:row-start-2',
  'md:hidden xl:flex',
];

/**
 * The five stages in three arrangements, from one list of markup:
 *
 *  - phone: a vertical timeline, each card near full width, with the arrows
 *    turned to point down;
 *  - tablet: a 2 + 2 + 1 grid, arrows across each row;
 *  - xl and up: all five in a row, left to right. Five cards need roughly
 *    1280px before each has room for a title and an illustration.
 */
export default function Workflow() {
  return (
    <motion.div
      variants={stagger(0.1, 0.1)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.05 }}
      className="mx-auto flex w-full max-w-[560px] flex-col items-stretch md:grid md:max-w-[860px] md:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] md:gap-y-6 xl:flex xl:max-w-shell xl:flex-row"
    >
      {STEPS.map(({ number, tone, title, description, Visual }, i) => (
        <div key={number} className="contents">
          <WorkflowStep
            number={number}
            tone={tone}
            title={title}
            description={description}
            className={TABLET_STEP[i]}
          >
            <Visual />
          </WorkflowStep>

          {i < STEPS.length - 1 && (
            <WorkflowConnector
              from={tone}
              to={STEPS[i + 1].tone}
              index={i}
              className={TABLET_CONNECTOR[i]}
            />
          )}
        </div>
      ))}
    </motion.div>
  );
}
