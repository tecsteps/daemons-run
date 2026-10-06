import { AlertTriangle, Info, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Inline notice: errors always say what to do next, with a retry when it helps. */
export function Notice({
  tone = 'error',
  children,
  onRetry,
  className,
}: {
  tone?: 'error' | 'info' | 'warning';
  children: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md border border-l-4 p-3 text-body',
        tone === 'error' && 'border-red bg-red/10 text-ink-900',
        tone === 'warning' && 'border-amber bg-amber/10 text-ink-900',
        tone === 'info' && 'border-lime bg-surface text-ink-900',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-red' : tone === 'warning' ? 'text-amber-deep' : 'text-lime-deep')} aria-hidden />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="-my-1 shrink-0">
          <RotateCw />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-md border border-line bg-surface" />
      ))}
    </div>
  );
}
