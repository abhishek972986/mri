/**
 * UI primitives for the clinical app. One place for buttons, badges, cards,
 * fields and loading/empty/error states, so every page speaks the same visual
 * language and motion.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { forwardRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { EASE, SPRING } from '../landing/motion';
import { initials, statusOf } from './format';

/* ------------------------------------------------------------------ buttons */

const VARIANT = {
  primary: 'nv-btn-primary',
  secondary: 'nv-btn-secondary',
  ghost: 'cx-btn-ghost',
  danger: 'cx-btn-danger',
};
const SIZE = {
  sm: 'min-h-[36px] px-3.5 text-[13px] gap-1.5',
  md: 'min-h-[42px] px-[18px] text-[14px]',
  lg: 'min-h-[48px] px-6 text-[15px]',
};

const press = {
  rest: { y: 0, scale: 1 },
  hover: { y: -1, scale: 1.01 },
  press: { y: 1, scale: 0.97, transition: SPRING.press },
};
const nudge = { rest: { x: 0 }, hover: { x: 3 }, press: { x: 4 } };

/**
 * Button or link. Pass `to` for in-app navigation, `href` for a plain link,
 * otherwise it is a <button>. `loading` disables it and shows a spinner.
 */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', to, href, loading = false, disabled, icon: Icon, arrow = false, className = '', children, ...rest },
  ref,
) {
  const classes = `nv-btn ${VARIANT[variant]} ${SIZE[size]} ${className}`;
  const inactive = disabled || loading;
  const motionProps = {
    initial: 'rest',
    animate: 'rest',
    whileHover: inactive ? undefined : 'hover',
    whileTap: inactive ? undefined : 'press',
    variants: press,
    transition: SPRING.button,
  };
  const content = (
    <>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden strokeWidth={2} /> : null}
      {children && <span>{children}</span>}
      {arrow && !loading && (
        <motion.span variants={nudge} transition={SPRING.icon} className="inline-grid" aria-hidden>
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        </motion.span>
      )}
    </>
  );

  if (to && !inactive) {
    return (
      <MotionLink ref={ref} to={to} className={classes} {...motionProps} {...rest}>
        {content}
      </MotionLink>
    );
  }
  if (href && !inactive) {
    return (
      <motion.a ref={ref} href={href} className={classes} {...motionProps} {...rest}>
        {content}
      </motion.a>
    );
  }
  return (
    <motion.button
      ref={ref}
      type="button"
      className={classes}
      disabled={inactive}
      aria-busy={loading || undefined}
      {...motionProps}
      {...rest}
    >
      {content}
    </motion.button>
  );
});

const MotionLink = motion.create(Link);

/* ------------------------------------------------------------------ badges */

const TONES = {
  slate: 'bg-[#EEF2F8] text-[#475569] ring-[#DDE5F0]',
  blue: 'bg-[#EAF2FE] text-[#0B5CC4] ring-[#CFE1FB]',
  green: 'bg-[#E9F7F1] text-[#0B7A57] ring-[#CDEBDD]',
  amber: 'bg-[#FFF5E6] text-[#9A5B00] ring-[#F7DDB0]',
  red: 'bg-[#FDEEEE] text-[#B42318] ring-[#F8D3D1]',
  violet: 'bg-[#F2EEFE] text-[#5B3CC4] ring-[#E0D8FB]',
};

export function Badge({ tone = 'slate', children, className = '', dot = false, live = false }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50 motion-reduce:animate-none" />}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className = '' }) {
  const info = statusOf(status);
  return (
    <Badge tone={info.tone} dot live={info.live} className={className}>
      <span title={info.hint}>{info.label}</span>
    </Badge>
  );
}

/* ------------------------------------------------------------------ surfaces */

export function Card({ as: Tag = 'section', className = '', hover = false, children, ...rest }) {
  return (
    <Tag className={`cx-card ${hover ? 'cx-card-hover' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, icon: Icon, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Entrance for page content: a soft rise, staggered by `index`. */
export function Reveal({ index = 0, className = '', children, as = 'div' }) {
  const Tag = motion[as] ?? motion.div;
  return (
    <Tag
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay: Math.min(index, 8) * 0.05 }}
      className={className}
    >
      {children}
    </Tag>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions, back }) {
  return (
    <Reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        {eyebrow && <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">{eyebrow}</p>}
        <h1 className="text-[clamp(1.5rem,1.2rem+1vw,2rem)] font-bold leading-tight tracking-[-0.022em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[70ch] text-[14.5px] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </Reveal>
  );
}

export function Avatar({ name, src, size = 40, className = '' }) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#DCEBFE] to-[#EEF4FF] font-display font-bold text-brand-deep ring-1 ring-[#D6E4F8] ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(name)}
      {src && (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ states */

/** Loading placeholder. Pass `as="span"` inside text (a <div> may not sit in a <p> or heading). */
export function Skeleton({ as: Tag = 'div', className = '', style }) {
  return <Tag className={`cx-skeleton ${className}`} style={style} aria-hidden />;
}

export function SkeletonRows({ rows = 5, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      {Icon && (
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Icon className="h-6 w-6" strokeWidth={1.7} />
        </span>
      )}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-[46ch] text-[13.5px] text-ink-soft">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong', className = '' }) {
  return (
    <div role="alert" className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-blush-soft text-blush">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.8} />
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-[52ch] text-[13.5px] text-ink-soft">{error?.message || String(error || '')}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineAlert({ tone = 'red', children, className = '' }) {
  const styles = {
    red: 'border-[#F8D3D1] bg-[#FFF6F5] text-[#8F1D14]',
    amber: 'border-[#F4DDB2] bg-[#FFF9EE] text-[#7A4A00]',
    blue: 'border-[#D5E5FB] bg-[#F3F8FF] text-[#12457F]',
    green: 'border-[#CDEBDD] bg-[#F1FAF6] text-[#0B5F44]',
  };
  return (
    <AnimatePresence initial={false}>
      {children && (
        <motion.div
          role={tone === 'red' ? 'alert' : 'status'}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: EASE }}
          className={`rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-snug ${styles[tone]} ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ fields */

export function Field({ label, required = false, hint, error, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children({ id, invalid: !!error }) : children;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-[#2A3752]">
          {label}
          {required && <span className="ml-0.5 text-blush" aria-hidden> *</span>}
          {required && <span className="sr-only"> (required)</span>}
        </label>
      )}
      {child}
      {error ? (
        <p className="mt-1.5 text-[12.5px] font-medium text-blush" role="alert">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12.5px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ invalid, className = '', ...rest }) {
  return <input className={`cx-input ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function TextArea({ invalid, className = '', ...rest }) {
  return <textarea className={`cx-input ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ invalid, className = '', children, ...rest }) {
  return (
    <select className={`cx-input ${className}`} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

/** A labelled value in a definition grid. Hides itself when there is no value. */
export function Detail({ label, value, className = '', always = false }) {
  if (!always && (value === null || value === undefined || value === '')) return null;
  return (
    <div className={className}>
      <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="mt-1 whitespace-pre-line text-[14.5px] text-ink">{value ?? <span className="text-ink-faint">Not recorded</span>}</dd>
    </div>
  );
}

/** Tabs with an animated underline. */
export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b border-[#E3EAF5] ${className}`}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`relative shrink-0 whitespace-nowrap px-3.5 pb-3 pt-2 text-[14px] font-semibold transition-colors duration-200 ${
              active ? 'text-brand' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className={`ml-1.5 rounded-full px-1.5 py-[1px] text-[11px] ${active ? 'bg-brand-soft text-brand' : 'bg-[#EEF2F8] text-ink-soft'}`}>
                {tab.count}
              </span>
            )}
            {active && (
              <motion.span
                layoutId="cx-tab-underline"
                transition={SPRING.button}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-brand"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The standing AI-safety note shown wherever model output is displayed. */
export function DecisionSupportNote({ className = '', children }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl border border-[#F4DDB2] bg-[#FFF9EE] px-3.5 py-2.5 text-[12.5px] leading-snug text-[#7A4A00] ${className}`}>
      <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <span>
        {children ?? 'AI-assisted analysis for decision support. Findings are preliminary and require review by a qualified clinician — the treating doctor remains the decision-maker.'}
      </span>
    </p>
  );
}
