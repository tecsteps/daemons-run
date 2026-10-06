// Adapted from old daemons-run resources/js/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'h-9 w-full min-w-0 rounded-md border border-line bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-ink-900 selection:text-ink-900 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink-900 placeholder:text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 phone:h-11 phone:min-h-11 md:text-sm',
                'aria-invalid:border-red aria-invalid:ring-red/20',
                className,
            )}
            {...props}
        />
    );
}

export { Input };
