// Adapted from old daemons-run resources/js/components/ui/dropdown-menu.tsx
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import type {
    ComponentPropsWithoutRef,
    ComponentRef,
    RefObject,
} from 'react';
import { createContext, forwardRef, useContext, useRef } from 'react';

import { suppressFocusRing } from '@/components/ui/focus-ring';
import { cn } from '@/lib/utils';

type MenuPointerFocus = {
    openedByPointer: boolean;
    trigger: HTMLElement | null;
};

const MenuPointerFocusContext = createContext<RefObject<MenuPointerFocus> | null>(
    null,
);

function DropdownMenu(
    props: Readonly<ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>>,
) {
    const focus = useRef<MenuPointerFocus>({
        openedByPointer: false,
        trigger: null,
    });

    return (
        <MenuPointerFocusContext.Provider value={focus}>
            <DropdownMenuPrimitive.Root {...props} />
        </MenuPointerFocusContext.Provider>
    );
}

const DropdownMenuTrigger = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ onPointerDown, onKeyDown, ...props }, forwardedRef) => {
    const focus = useContext(MenuPointerFocusContext);

    return (
        <DropdownMenuPrimitive.Trigger
            {...props}
            ref={(node) => {
                if (focus) {
                    focus.current.trigger =
                        node instanceof HTMLElement ? node : null;
                }

                if (typeof forwardedRef === 'function') {
                    forwardedRef(node);
                } else if (forwardedRef) {
                    forwardedRef.current = node;
                }
            }}
            onPointerDown={(event) => {
                if (focus) {
                    focus.current.openedByPointer = true;
                }

                onPointerDown?.(event);
            }}
            onKeyDown={(event) => {
                if (
                    focus &&
                    (event.key === 'Enter' ||
                        event.key === ' ' ||
                        event.key === 'ArrowDown' ||
                        event.key === 'ArrowUp')
                ) {
                    focus.current.openedByPointer = false;
                }

                onKeyDown?.(event);
            }}
        />
    );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;


const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuSubTrigger = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
        inset?: boolean;
    }
>(({ className, inset, children, ...props }, ref) => (
    <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        className={cn(
            'flex min-h-10 cursor-default items-center gap-2 rounded-sm px-2 py-2 text-control outline-none select-none focus:bg-surface data-[state=open]:bg-surface data-[highlighted]:bg-surface phone:min-h-11',
            inset && 'pl-8',
            className,
        )}
        {...props}
    >
        {children}
        <ChevronRight className="ml-auto h-4 w-4" />
    </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName =
    DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.SubContent
        ref={ref}
        className={cn(
            'z-50 min-w-36 overflow-hidden rounded-md border border-line bg-canvas p-1 shadow-[0_8px_24px_rgba(5,7,8,0.12)]',
            className,
        )}
        {...props}
    />
));
DropdownMenuSubContent.displayName =
    DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, onCloseAutoFocus, onInteractOutside, ...props }, ref) => {
    const focus = useContext(MenuPointerFocusContext);
    const interactedOutside = useRef(false);

    return (
    <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            onInteractOutside={(event) => {
                interactedOutside.current = true;
                onInteractOutside?.(event);
            }}
            onCloseAutoFocus={(event) => {
                onCloseAutoFocus?.(event);
                const outside = interactedOutside.current;
                interactedOutside.current = false;

                if (event.defaultPrevented || outside) {
                    return;
                }

                const state = focus?.current;

                if (!state?.openedByPointer || !state.trigger) {
                    return;
                }

                event.preventDefault();
                suppressFocusRing(state.trigger);
                state.trigger.focus({ preventScroll: true });
            }}
            className={cn(
                'z-50 max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-1rem))] min-w-48 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain rounded-md border border-line bg-canvas p-1 shadow-[0_8px_24px_rgba(5,7,8,0.12)] [-webkit-overflow-scrolling:touch]',
                className,
            )}
            {...props}
        />
    </DropdownMenuPrimitive.Portal>
    );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.Item>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
        inset?: boolean;
        destructive?: boolean;
    }
>(({ className, inset, destructive, ...props }, ref) => (
    <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(
            'relative flex min-h-10 cursor-default items-center gap-2 rounded-sm px-2 py-2 text-control outline-none select-none focus:bg-surface data-[highlighted]:bg-surface data-[disabled]:pointer-events-none data-[disabled]:text-muted phone:min-h-11',
            inset && 'pl-8',
            destructive &&
                'app-status-red focus:bg-red/10 focus:text-red data-[highlighted]:bg-red/10 data-[highlighted]:text-red',
            className,
        )}
        {...props}
    />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;


const DropdownMenuLabel = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.Label>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
        inset?: boolean;
    }
>(({ className, inset, ...props }, ref) => (
    <DropdownMenuPrimitive.Label
        ref={ref}
        className={cn(
            'px-2 py-1.5 font-mono text-caption tracking-wide text-muted uppercase',
            inset && 'pl-8',
            className,
        )}
        {...props}
    />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = forwardRef<
    ComponentRef<typeof DropdownMenuPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Separator
        ref={ref}
        className={cn('-mx-1 my-1 h-px bg-line', className)}
        {...props}
    />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
};
