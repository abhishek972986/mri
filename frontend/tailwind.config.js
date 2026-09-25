/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Preflight is off on purpose: this bundle also contains the dark clinical
  // dashboard, which styles bare elements globally in src/styles.css. A global
  // reset landing on top of it would restyle the dashboard too. The landing
  // page carries its own scoped reset instead — see src/landing/landing.css.
  corePlugins: { preflight: false },
  // `hover:` utilities only apply where a pointer can actually hover. On a
  // touch screen a tap would otherwise leave the hover state stuck on.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      maxWidth: {
        // One content width for every section, so nothing drifts apart on a
        // wide monitor. The background still runs edge to edge.
        shell: '1440px',
      },
      colors: {
        brand: {
          DEFAULT: '#1677E8',
          deep: '#0B4FC4',
          soft: '#EAF1FE',
        },
        ink: {
          DEFAULT: '#0D1424',
          soft: '#5B6B85',
          faint: '#8B9AB3',
        },
        mint: {
          DEFAULT: '#12A97C',
          soft: '#EAF7F1',
          line: '#D3EDE1',
        },
        blush: {
          DEFAULT: '#E5484D',
          soft: '#FDEEEE',
          line: '#F8DADA',
        },
        cyan: {
          glow: '#4DD4FF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Headings. Jakarta's rounder, wider forms read friendlier than Inter
        // at display sizes, while Inter stays on body copy for legibility.
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Layered, navy-tinted shadows: a tight contact shadow plus one or two
      // wide, faint ambient ones. Never pure black, never a single hard drop.
      boxShadow: {
        soft: '0 1px 2px rgba(16, 38, 76, 0.04), 0 4px 12px rgba(16, 38, 76, 0.035), 0 12px 28px rgba(16, 38, 76, 0.03)',
        card: '0 1px 2px rgba(16, 38, 76, 0.04), 0 8px 24px rgba(16, 38, 76, 0.045), 0 24px 60px rgba(16, 38, 76, 0.055)',
        'card-hover': '0 1px 2px rgba(16, 38, 76, 0.04), 0 12px 32px rgba(16, 38, 76, 0.06), 0 32px 72px rgba(16, 38, 76, 0.075)',
        float: '0 2px 6px rgba(16, 38, 76, 0.04), 0 14px 40px rgba(16, 38, 76, 0.08)',
        nav: '0 1px 2px rgba(16, 38, 76, 0.035), 0 8px 24px rgba(16, 38, 76, 0.05), 0 20px 48px rgba(16, 38, 76, 0.04)',
        // Brand-coloured glow for small icon tiles and badges.
        brand: '0 1px 2px rgba(11, 79, 196, 0.18), 0 6px 18px rgba(22, 119, 232, 0.24)',
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.16, 1, 0.3, 1)',
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
        haze: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.06)' },
        },
        spinSlow: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        float: 'float 9s ease-in-out infinite',
        haze: 'haze 6s ease-in-out infinite',
        'spin-slow': 'spinSlow 38s linear infinite',
        'spin-slower': 'spinSlow 60s linear infinite reverse',
      },
    },
  },
  plugins: [],
};
