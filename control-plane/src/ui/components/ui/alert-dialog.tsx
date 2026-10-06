// Adapted from old daemons-run resources/js/components/ui/alert-dialog.tsx
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';
import { forwardRef } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Overlay
        ref={ref}
        className={cn('fixed inset-0 z-50 bg-ink-950/40 dark:bg-black/80', className)}
        {...props}
    />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Content>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
    <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogPrimitive.Content
            ref={ref}
            className={cn(
                'fixed top-1/2 left-1/2 z-50 grid max-h-[min(calc(100dvh-var(--app-bottom-nav-height)-1rem),calc(100svh-var(--app-bottom-nav-height)-1rem))] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-md border border-line bg-canvas p-5 shadow-[0_12px_40px_rgba(5,7,8,0.18)] phone:top-[calc(50%-var(--app-bottom-nav-height)/2)]',
                className,
            )}
            {...props}
        />
    </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
    <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />
);

const AlertDialogFooter = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);

const AlertDialogTitle = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Title>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Title ref={ref} className={cn('text-section font-semibold text-ink-900', className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Description>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Description ref={ref} className={cn('text-body text-muted', className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogCancel = ({ className, ...props }: ComponentPropsWithoutRef<typeof Button>) => (
    <AlertDialogPrimitive.Cancel asChild>
        <Button type="button" variant="secondary" className={className} {...props} />
    </AlertDialogPrimitive.Cancel>
);

const AlertDialogAction = ({ className, ...props }: ComponentPropsWithoutRef<typeof Button>) => (
    <AlertDialogPrimitive.Action asChild>
        <Button type="button" variant="destructive" className={className} {...props} />
    </AlertDialogPrimitive.Action>
);

export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
};
