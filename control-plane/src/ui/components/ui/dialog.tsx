// Adapted from old daemons-run resources/js/components/ui/dialog.tsx
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ComponentRef, HTMLAttributes } from 'react';
import { forwardRef, useRef } from 'react';

import { dialogReturnFocusTarget, focusOpenedByPointer, suppressFocusRing } from '@/components/ui/focus-ring';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
    ComponentRef<typeof DialogPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
            'fixed inset-0 z-50 bg-ink-950/40 dark:bg-black/80',
            className,
        )}
        {...props}
    />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = forwardRef<
    ComponentRef<typeof DialogPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
        overlayClassName?: string;
    }
>(({ className, overlayClassName, children, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
    const openedByPointerRef = useRef(false);
    const returnFocusRef = useRef<HTMLElement | null>(null);

    return (
    <DialogPortal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
            ref={ref}
            tabIndex={-1}
            onOpenAutoFocus={(event) => {
                onOpenAutoFocus?.(event);

                if (event.defaultPrevented) {
                    return;
                }

                const byPointer = focusOpenedByPointer();
                openedByPointerRef.current = byPointer;
                returnFocusRef.current = dialogReturnFocusTarget();
                placeDialogOpenFocus(event, byPointer);
            }}
            onCloseAutoFocus={(event) => {
                onCloseAutoFocus?.(event);

                if (event.defaultPrevented) {
                    return;
                }

                /**
                 * Radix returns focus only to a DialogTrigger. Dialogs opened
                 * from controlled state have none, so focus would fall to
                 * <body>; send it back to the element that opened the dialog.
                 */
                const back = returnFocusRef.current;

                if (!back || !document.contains(back)) {
                    return;
                }

                event.preventDefault();

                if (openedByPointerRef.current) {
                    suppressFocusRing(back);
                }

                back.focus({ preventScroll: true });
            }}
            className={cn(
                'fixed top-1/2 left-1/2 z-50 grid max-h-[min(calc(100dvh-var(--app-bottom-nav-height)-1rem),calc(100svh-var(--app-bottom-nav-height)-1rem))] w-[calc(100%-2rem)] max-w-md touch-pan-y -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-md border border-line bg-canvas p-5 shadow-[0_12px_40px_rgba(5,7,8,0.18)] [-webkit-overflow-scrolling:touch] phone:top-[calc(50%-var(--app-bottom-nav-height)/2)]',
                className,
            )}
            {...props}
        >
            {children}
            <DialogPrimitive.Close className="absolute top-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted outline-none hover:bg-surface hover:text-ink-900">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
        </DialogPrimitive.Content>
    </DialogPortal>
    );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

function placeDialogOpenFocus(event: Event, byPointer: boolean): void {
    const content = event.currentTarget;

    if (!(content instanceof HTMLElement)) {
        return;
    }

    const field = content.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    );

    if (field) {
        event.preventDefault();

        if (byPointer) {
            suppressFocusRing(field);
        }

        field.focus({ preventScroll: true });

        return;
    }

    if (!byPointer) {
        return;
    }

    event.preventDefault();
    suppressFocusRing(content);
    content.focus({ preventScroll: true });
}

const DialogHeader = ({
    className,
    ...props
}: HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn('flex flex-col gap-1.5 pr-8 text-left', className)}
        {...props}
    />
);

const DialogFooter = ({
    className,
    ...props
}: HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
            className,
        )}
        {...props}
    />
);

const DialogTitle = forwardRef<
    ComponentRef<typeof DialogPrimitive.Title>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn('font-sans text-section font-bold text-ink-900', className)}
        {...props}
    />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = forwardRef<
    ComponentRef<typeof DialogPrimitive.Description>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn('text-body text-muted', className)}
        {...props}
    />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger,
};
