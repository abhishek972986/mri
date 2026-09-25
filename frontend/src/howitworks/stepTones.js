/**
 * Per-step accents for the workflow.
 *
 * The page is meant to read as one neutral surface with a hint of colour per
 * stage, not as five coloured cards — so the tints here are barely-there
 * washes and the saturation is spent on the badge, the title and the
 * connector instead.
 *
 * `title` follows the reference rather than a rule: the first two steps are
 * navy and only the last three take their accent. Encoded as data because
 * there is no logic behind it to derive.
 */
export const STEP_TONES = {
  blue: {
    card: 'from-[#F4F9FF] to-[#FAFCFF] border-[#E1ECFA]',
    badge: 'bg-[#E6F0FD] text-[#1677E8]',
    title: 'text-[#1677E8]',
    line: '#1677E8',
  },
  mint: {
    card: 'from-[#F1FAF6] to-[#FAFDFB] border-[#DDEFE6]',
    badge: 'bg-[#E3F5EC] text-[#12A06F]',
    title: 'text-ink',
    line: '#12A06F',
  },
  rose: {
    card: 'from-[#FEF4F5] to-[#FEFAFA] border-[#F8E0E2]',
    badge: 'bg-[#FCE8EA] text-[#E0484F]',
    title: 'text-[#E0484F]',
    line: '#E0484F',
  },
  violet: {
    card: 'from-[#F8F5FE] to-[#FCFBFE] border-[#EAE2FA]',
    badge: 'bg-[#EFE8FC] text-[#7C5BD6]',
    title: 'text-[#7C5BD6]',
    line: '#7C5BD6',
  },
  navy: {
    card: 'from-[#F4F9FF] to-[#FAFCFF] border-[#E1ECFA]',
    badge: 'bg-[#E6F0FD] text-[#1677E8]',
    title: 'text-ink',
    line: '#1677E8',
  },
};
