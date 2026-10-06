// Adapted from old daemons-run resources/js/lib/utils.ts
import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only recognizes Tailwind's default theme scale out of the
 * box. Our `--color-*` and `--text-*` tokens in resources/css/app.css
 * (styleguide.md §3) are custom names, so plain `twMerge` cannot tell a
 * font-size utility (`text-control`) from a text-color utility
 * (`text-ink-900`) and silently drops one of them as a "conflict" — this is
 * what caused unreadable OAuth buttons on /login (white/muted text on
 * lime/white). Registering both scales keeps them in separate class groups.
 */
const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            color: [
                'ink-950',
                'ink-900',
                'canvas',
                'surface',
                'bone',
                'muted',
                'muted-bright',
                'line',
                'lime',
                'lime-deep',
                'lime-pale',
                'purple',
                'cyan',
                'cyan-deep',
                'green',
                'amber',
                'red',
                'red-deep',
            ],
            text: [
                'page',
                'section',
                'card',
                'body',
                'control',
                'tech',
                'caption',
                'page-phone',
            ],
            spacing: ['page', 'card', 'field'],
            container: ['form', 'frame', 'console', 'focus'],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** Preserve a path's leading slashes and remove its trailing separators in one pass. */
