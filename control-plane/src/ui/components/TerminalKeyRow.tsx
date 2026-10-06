// Adapted from old daemons-run resources/js/components/TerminalKeyRow.tsx
import { ClipboardPaste, Keyboard, TextSelect } from 'lucide-react';
import { useRef } from 'react';
import { KEY } from '@/lib/terminalKeys';
import { cn } from '@/lib/utils';

type Key = { id: string; label: string; aria: string; send?: string };

const KEYS: Key[] = [
  { id: 'esc', label: 'Esc', aria: 'Escape', send: KEY.esc },
  { id: 'tab', label: 'Tab', aria: 'Tab', send: KEY.tab },
  { id: 'ctrl', label: 'Ctrl', aria: 'Control modifier' },
  { id: 'slash', label: '/', aria: 'Slash', send: '/' },
  { id: 'pipe', label: '|', aria: 'Pipe', send: '|' },
  { id: 'tilde', label: '~', aria: 'Tilde', send: '~' },
  { id: 'hide', label: 'Hide keyboard', aria: 'Hide keyboard' },
  { id: 'left', label: '←', aria: 'Arrow left', send: KEY.left },
  { id: 'up', label: '↑', aria: 'Arrow up', send: KEY.up },
  { id: 'down', label: '↓', aria: 'Arrow down', send: KEY.down },
  { id: 'right', label: '→', aria: 'Arrow right', send: KEY.right },
  { id: 'paste', label: 'Paste', aria: 'Paste' },
  { id: 'select', label: 'Select', aria: 'Select text to copy' },
];

export function TerminalKeyRow({
  onSend,
  ctrl,
  onCtrl,
  onPaste,
  onSelect,
  onHideKeyboard,
}: {
  onSend: (data: string) => void;
  ctrl: boolean;
  onCtrl: (on: boolean) => void;
  onPaste: () => void;
  onSelect: () => void;
  onHideKeyboard: () => void;
}) {
  // iOS Safari can deliver one tap as two clicks: a second Ctrl toggle within 350 ms is the same tap.
  const lastCtrl = useRef(-Infinity);
  const toggleCtrl = () => {
    const now = performance.now();
    if (now - lastCtrl.current < 350) return;
    lastCtrl.current = now;
    onCtrl(!ctrl);
  };
  return (
    <fieldset
      data-testid="terminal-key-row"
      aria-label="Terminal keys"
      className="grid w-full max-w-full min-w-0 shrink-0 touch-manipulation grid-cols-7 gap-1 border-t border-white/10 bg-ink-950 px-1 py-1"
    >
      {KEYS.map((key) => {
        const pressed = key.id === 'ctrl' && ctrl;
        return (
          <button
            key={key.id}
            type="button"
            data-testid={`terminal-key-${key.id}`}
            aria-label={key.aria}
            aria-pressed={key.id === 'ctrl' ? ctrl : undefined}
            // Keep focus (and the on-screen keyboard) on the terminal.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              if (key.id === 'ctrl') toggleCtrl();
              else if (key.id === 'paste') onPaste();
              else if (key.id === 'select') onSelect();
              else if (key.id === 'hide') onHideKeyboard();
              else if (key.send) onSend(key.send);
            }}
            className={cn(
              'inline-flex min-h-11 min-w-0 items-center justify-center rounded-md border px-1 font-mono text-caption',
              pressed ? 'border-ink-900 bg-lime text-ink-900' : 'border-white/10 bg-white/5 text-bone active:bg-white/15',
            )}
          >
            {key.id === 'hide' ? (
              <Keyboard className="size-4" aria-hidden />
            ) : key.id === 'paste' ? (
              <ClipboardPaste className="size-4" aria-hidden />
            ) : key.id === 'select' ? (
              <TextSelect className="size-4" aria-hidden />
            ) : (
              key.label
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
