// Adapted from old daemons-run resources/js/components/ui/checkbox.tsx
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

const Checkbox = forwardRef<
    ComponentRef<typeof CheckboxPrimitive.Root>,
    ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
            'group/checkbox relative peer h-4 w-4 shrink-0 rounded-[4px] border border-input bg-background dark:border-muted data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:text-background disabled:cursor-not-allowed disabled:border-muted phone:h-11 phone:w-11 phone:border-0 phone:bg-transparent phone:data-[state=checked]:bg-transparent phone:disabled:bg-transparent',
            className,
        )}
        {...props}
    >
        <span className="pointer-events-none flex items-center justify-center phone:absolute phone:top-1/2 phone:left-1/2 phone:h-4 phone:w-4 phone:-translate-x-1/2 phone:-translate-y-1/2 phone:rounded-[4px] phone:border phone:border-input phone:bg-background phone:dark:border-muted phone:group-data-[state=checked]/checkbox:bg-primary phone:group-data-[disabled]/checkbox:border-muted">
            <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
                <Check className="h-3 w-3" strokeWidth={3} />
            </CheckboxPrimitive.Indicator>
        </span>
    </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
