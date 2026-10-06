// Adapted from old daemons-run resources/js/components/ui/switch.tsx
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Switch as SwitchPrimitive } from 'radix-ui';

function Switch({
    className,
    ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                'group/switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-ink-900 bg-surface transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-60 phone:h-11 phone:w-11 phone:border-transparent phone:bg-transparent data-[state=checked]:bg-lime phone:data-[state=checked]:bg-transparent',
                className,
            )}
            {...props}
        >
            <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-1/2 h-6 w-11 -translate-y-1/2 rounded-full border border-ink-900 bg-surface group-data-[state=checked]/switch:bg-lime"
            >
                <SwitchPrimitive.Thumb
                    data-slot="switch-thumb"
                    className="pointer-events-none block h-4 w-4 translate-y-0.5 rounded-full bg-ink-900 transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1"
                />
            </span>
        </SwitchPrimitive.Root>
    );
}

export { Switch };
