// Adapted from old daemons-run resources/js/components/ui/spinner.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

function Spinner({ className, ...props }: Readonly<React.ComponentProps<'svg'>>) {
    return (
        <Loader2Icon
            role="status"
            aria-label="Loading"
            className={cn('size-4 animate-spin', className)}
            {...props}
        />
    );
}

export { Spinner };
