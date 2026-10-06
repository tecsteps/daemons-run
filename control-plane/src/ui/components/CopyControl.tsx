// Adapted from old daemons-run resources/js/components/CopyControl.tsx
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';

export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), []);
  const copy = useCallback(async (value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    }
    return ok;
  }, []);
  return { copied, copy };
}

export function CopyControl({
  value,
  label = 'Copy',
  iconOnly = false,
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  value: string;
  label?: ReactNode;
  iconOnly?: boolean;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button
      variant={variant}
      size={iconOnly ? 'icon-sm' : size}
      className={className}
      aria-label={iconOnly ? (copied ? 'Copied' : typeof label === 'string' ? label : 'Copy') : undefined}
      onClick={() => void copy(value)}
    >
      {copied ? <Check /> : <Copy />}
      {iconOnly ? null : copied ? 'Copied' : label}
    </Button>
  );
}

/** A command or URL in Geist Mono with a copy button, wrapping on phones. */
export function CopyField({ value, testId }: { value: string; testId?: string }) {
  return (
    <div data-testid={testId} className="flex min-w-0 items-start gap-2 rounded-md border border-line bg-surface p-2 pl-3">
      <code className="min-w-0 flex-1 py-1 font-mono text-tech break-all text-ink-900">{value}</code>
      <CopyControl value={value} iconOnly label="Copy" />
    </div>
  );
}
