/**
 * Stands in for the specimen before it is loaded.
 *
 * Deliberately free of any three.js import: it is the Suspense fallback for
 * the lazily-loaded viewer, so pulling the 3D stack in here would defeat the
 * split it exists to support.
 */
export default function BrainPlaceholder({ progress = 0, error = null }) {
  if (error) {
    return (
      <div className="absolute inset-0 grid place-items-center px-6 text-center">
        <p className="max-w-xs text-[13.5px] text-ink-soft">
          The 3D specimen could not be loaded. Check that{' '}
          <code className="rounded bg-[#eef3fb] px-1 py-0.5 text-[12px]">/models/brain.glb</code> is
          being served.
        </p>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#dde8f8] border-t-brand" />
        <span className="text-[12.5px] font-medium text-ink-faint">
          Loading 3D brain… {Math.round(progress * 100)}%
        </span>
      </div>
    </div>
  );
}
