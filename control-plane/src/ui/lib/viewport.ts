// Adapted from old daemons-run resources/js/lib/terminalKeyboard.ts (useVisualViewportHeight).
import { useEffect, useState } from 'react';

export type ViewportBox = { height: number; offsetTop: number; keyboard: boolean };

function read(): ViewportBox {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  // An on-screen keyboard shrinks the visual viewport well below the layout viewport.
  return { height, offsetTop: vv?.offsetTop ?? 0, keyboard: window.innerHeight - height > 80 };
}

/** The usable viewport while an on-screen keyboard is open (iOS does not resize the layout). */
export function useVisualViewport(): ViewportBox {
  const [box, setBox] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setBox(read());
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return box;
}

export function useCoarsePointer(): boolean {
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  return coarse;
}
