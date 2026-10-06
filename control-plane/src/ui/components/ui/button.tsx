// Adapted from old daemons-run resources/js/components/ui/button.tsx
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-sans text-control font-medium whitespace-nowrap transition-[color,background-color,box-shadow,border-color] duration-150 select-none disabled:pointer-events-none disabled:shadow-none outline-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    {
        variants: {
            variant: {
                primary:
                    'border-2 border-ink-900 bg-lime text-ink-900 shadow-none hover:bg-lime/90 hover:shadow-[0_2px_0_0_#11120F] disabled:border-line disabled:bg-surface disabled:text-muted',
                default:
                    'border-2 border-ink-900 bg-lime text-ink-900 shadow-none hover:bg-lime/90 hover:shadow-[0_2px_0_0_#11120F] disabled:border-line disabled:bg-surface disabled:text-muted',
                secondary:
                    'border border-line bg-canvas text-ink-900 hover:bg-surface disabled:border-line disabled:bg-surface disabled:text-muted',
                outline:
                    'border border-line bg-canvas text-ink-900 hover:bg-surface disabled:border-line disabled:bg-surface disabled:text-muted',
                quiet: 'border border-transparent bg-transparent text-ink-900 hover:bg-surface disabled:bg-transparent disabled:text-muted',
                ghost: 'border border-transparent bg-transparent text-ink-900 hover:bg-surface disabled:bg-transparent disabled:text-muted',
                link: 'border border-transparent bg-transparent text-ink-900 underline-offset-4 hover:underline disabled:bg-transparent disabled:text-muted',
                destructive:
                    'border border-red bg-canvas text-red hover:bg-red/10 disabled:border-line disabled:bg-surface disabled:text-muted',
                'destructive-fill':
                    'border border-[#9f2429] bg-[#c93338] text-white hover:bg-[#b52b30] disabled:border-[#9f2429] disabled:bg-[#c93338] disabled:text-white disabled:opacity-100 disabled:brightness-75',
            },
            size: {
                default:
                    'h-10 min-w-10 px-3.5 phone:h-11 phone:min-h-11 phone:min-w-11',
                cta: 'h-11 min-w-11 px-4 text-control font-semibold',
                xs: 'h-6 min-w-6 gap-1 px-2 text-caption phone:h-11 phone:min-h-11 phone:min-w-11',
                sm: 'h-8 min-w-8 px-2.5 text-caption phone:h-11 phone:min-h-11 phone:min-w-11',
                lg: 'h-11 min-w-11 px-4',
                icon: 'h-10 w-10 phone:h-11 phone:w-11',
                'icon-xs': 'h-6 w-6 phone:h-11 phone:w-11',
                'icon-sm': 'h-8 w-8 phone:h-11 phone:w-11',
                'icon-lg': 'h-11 w-11',
            },
        },
        defaultVariants: {
            variant: 'primary',
            size: 'default',
        },
    },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, type, ...props }, ref) => {
        const Comp = asChild ? Slot.Root : 'button';

        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                type={asChild ? undefined : (type ?? 'button')}
                {...props}
            />
        );
    },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
