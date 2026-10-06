// Adapted from old daemons-run resources/js/components/StatusPill.tsx (treatments only).
import { cn } from '@/lib/utils';

export type Status = 'online' | 'offline' | 'creating' | 'installing' | 'failed' | 'public' | 'private' | 'up' | 'down';

const treatments: Record<Status, { wrap: string; dot: string; label: string; pulse?: boolean }> = {
  online: { wrap: 'bg-lime-pale text-ink-900', dot: 'bg-green outline outline-1 outline-ink-900/40', label: 'Online' },
  up: { wrap: 'bg-lime-pale text-ink-900', dot: 'bg-green outline outline-1 outline-ink-900/40', label: 'Listening' },
  offline: { wrap: 'bg-amber/10 text-amber-deep', dot: 'bg-amber', label: 'Offline' },
  down: { wrap: 'bg-surface text-muted', dot: 'bg-muted', label: 'Not listening' },
  creating: { wrap: 'bg-purple/10 text-purple', dot: 'bg-purple', label: 'Creating', pulse: true },
  installing: { wrap: 'bg-purple/10 text-purple', dot: 'bg-purple', label: 'Installing', pulse: true },
  failed: { wrap: 'bg-red/10 text-red-deep', dot: 'bg-red', label: 'Failed' },
  public: { wrap: 'bg-amber/10 text-amber-deep', dot: 'bg-amber', label: 'Public link' },
  private: { wrap: 'bg-surface text-muted', dot: 'bg-muted', label: 'Private' },
};

export function StatusPill({ status, label, className, size = 'md' }: { status: Status; label?: string; className?: string; size?: 'sm' | 'md' }) {
  const t = treatments[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-sans font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[11px] leading-none' : 'h-6 px-2 text-caption leading-none',
        t.wrap,
        className,
      )}
    >
      <span aria-hidden className={cn('shrink-0 rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2', t.dot, t.pulse && 'motion-safe:animate-pulse')} />
      <span>{label ?? t.label}</span>
    </span>
  );
}
