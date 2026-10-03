import { useMemo, useRef, useState } from 'react';
import { formatDate, num, toDate } from '../format';

/**
 * Total segmented lesion volume per analysed scan, over acquisition time.
 *
 * One series, so no legend: the card title names it. Values are the
 * pipeline's own `total_volume_cm3` — nothing interpolated or projected.
 * Points are spaced by real time, not evenly, so a long gap reads as one.
 */
export default function VolumeTrendChart({ points, onSelect, height = 220 }) {
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);

  const data = useMemo(() => points
    .filter((p) => p.total_volume_cm3 != null)
    .map((p) => ({ ...p, t: toDate(p.acquired_on || p.created_at).getTime() }))
    .sort((a, b) => a.t - b.t), [points]);

  if (data.length < 2) return null;

  const W = 640;
  const H = height;
  const pad = { l: 44, r: 18, t: 16, b: 30 };
  const tMin = data[0].t;
  const tMax = data[data.length - 1].t;
  const vMax = Math.max(...data.map((d) => d.total_volume_cm3));
  const top = vMax <= 0 ? 1 : niceCeil(vMax * 1.15);
  const x = (t) => pad.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = [0, top / 2, top];
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.total_volume_cm3).toFixed(1)}`).join(' ');

  const hovered = hover != null ? data[hover] : null;

  return (
    <div ref={wrap} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
        aria-label={`Total lesion volume across ${data.length} scans, from ${num(data[0].total_volume_cm3, 2)} to ${num(data[data.length - 1].total_volume_cm3, 2)} cubic centimetres`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#EDF1F7" strokeWidth="1" />
            <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="#627089">{fmtTick(v)}</text>
          </g>
        ))}
        <text x={pad.l} y={H - 8} fontSize="11" fill="#627089">{formatDate(data[0].acquired_on || data[0].created_at)}</text>
        <text x={W - pad.r} y={H - 8} fontSize="11" fill="#627089" textAnchor="end">{formatDate(data[data.length - 1].acquired_on || data[data.length - 1].created_at)}</text>

        {hovered && <line x1={x(hovered.t)} x2={x(hovered.t)} y1={pad.t} y2={H - pad.b} stroke="#CFDBEE" strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke="#1677E8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <g key={d.id}>
            <circle cx={x(d.t)} cy={y(d.total_volume_cm3)} r={hover === i ? 5.5 : 4.5} fill="#1677E8" stroke="#fff" strokeWidth="2" />
            {/* Hit target bigger than the mark. */}
            <circle
              cx={x(d.t)} cy={y(d.total_volume_cm3)} r="16" fill="transparent"
              className="cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={`${formatDate(d.acquired_on || d.created_at)}: ${num(d.total_volume_cm3, 2)} cm³, ${d.lesion_count ?? 0} lesions`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(d)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(d); }}
            />
          </g>
        ))}
        <text x={pad.l} y={10} fontSize="11" fill="#627089">cm³</text>
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-[#E3EAF5] bg-white px-3 py-2 text-[12.5px] shadow-[0_8px_24px_rgba(16,38,76,0.12)]"
          style={{ left: `${(x(hovered.t) / W) * 100}%`, top: `calc(${(y(hovered.total_volume_cm3) / H) * 100}% - 12px)` }}
        >
          <p className="font-semibold text-ink">{formatDate(hovered.acquired_on || hovered.created_at)}</p>
          <p className="text-ink-soft">{num(hovered.total_volume_cm3, 2)} cm³ · {hovered.lesion_count ?? 0} {hovered.lesion_count === 1 ? 'lesion' : 'lesions'}</p>
        </div>
      )}
    </div>
  );
}

function niceCeil(value) {
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function fmtTick(v) {
  if (v === 0) return '0';
  return v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
}
