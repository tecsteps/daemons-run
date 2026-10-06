// Adapted from old daemons-run resources/js/components/ConfirmDestructive.tsx (typed-name confirm).
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function ConfirmDestructive({
  open,
  onOpenChange,
  title,
  description,
  expectedName,
  confirmLabel = 'Delete',
  pending = false,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  expectedName?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const matches = !expectedName || typed.trim() === expectedName;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-body text-muted">{description}</div>
          </DialogDescription>
        </DialogHeader>
        {children}
        {expectedName ? (
          <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
            <span>
              Type <code className="rounded-sm bg-surface px-1 font-mono">{expectedName}</code> to confirm
            </span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              className="h-11 font-sans"
              data-testid="confirm-name"
            />
          </label>
        ) : null}
        {error ? <p className="text-caption text-red">{error}</p> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive-fill" disabled={!matches || pending} onClick={onConfirm} data-testid="confirm-destructive">
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
