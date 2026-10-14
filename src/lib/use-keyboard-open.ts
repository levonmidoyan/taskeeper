'use client';

import { useEffect, useState } from 'react';

/** True while an on-screen keyboard takes a big share of the screen (the visual viewport shrinks, the layout one doesn't). */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);
  return open;
}
