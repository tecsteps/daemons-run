/**
 * Pointer vs keyboard focus. A dialog or menu that moves focus after a click
 * must not paint the keyboard ring; Tab still does.
 */

let openedByPointer = false;
let listening = false;
let returnFocusTarget: HTMLElement | null = null;

export function focusOpenedByPointer(): boolean {
    installFocusModality();

    return openedByPointer;
}

/** Resolve a transient row-menu item to the menu's persistent trigger. */
export function dialogReturnFocusTarget(): HTMLElement | null {
    const active = document.activeElement;
    const menu = active instanceof HTMLElement ? active.closest('[role="menu"]') : null;
    const triggerId = menu?.getAttribute('aria-labelledby');
    const trigger = triggerId ? document.getElementById(triggerId) : null;

    if (trigger) {
        return trigger;
    }

    if (active instanceof HTMLElement && active !== document.body && !menu) {
        return active;
    }

    return returnFocusTarget?.isConnected ? returnFocusTarget : null;
}

function markFocusOrigin(origin: 'pointer' | 'keyboard'): void {
    document.documentElement.dataset.focusOrigin = origin;
}

export function suppressFocusRing(element: HTMLElement): void {
    element.dataset.focusRing = 'suppress';

    const clear = () => {
        delete element.dataset.focusRing;
        element.removeEventListener('blur', clear);
        element.removeEventListener('pointerdown', clear);
    };

    element.addEventListener('blur', clear);
    element.addEventListener('pointerdown', clear);
}

function installFocusModality(): void {
    if (listening || typeof document === 'undefined') {
        return;
    }

    listening = true;

    document.addEventListener('focusin', () => {
        // Menu items unmount before a controlled dialog's autofocus runs.
        // Preserve their trigger while body temporarily owns focus.
        const target = dialogReturnFocusTarget();
        if (target && !target.closest('[role="dialog"], [role="alertdialog"]')) {
            returnFocusTarget = target;
        }
    });

    document.addEventListener(
        'pointerdown',
        () => {
            openedByPointer = true;
            markFocusOrigin('pointer');
        },
        true,
    );

    document.addEventListener(
        'keydown',
        (event) => {
            if (
                event.key === 'Tab' ||
                event.key === 'Enter' ||
                event.key === ' ' ||
                event.key.startsWith('Arrow')
            ) {
                openedByPointer = false;
                markFocusOrigin('keyboard');
            }
        },
        true,
    );
}

if (typeof document !== 'undefined') {
    installFocusModality();
}
