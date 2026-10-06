// Adapted from old daemons-run resources/js/components/ui/skeleton.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="skeleton"
            className={cn('animate-pulse rounded-md bg-line/60', className)}
            {...props}
        />
    );
}

export { Skeleton };
