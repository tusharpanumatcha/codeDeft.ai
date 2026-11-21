import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Popover behaviour for a trigger button + panel: Escape and clicking outside close it, focus moves
 * into the panel on open and returns to the trigger on close (WAI-ARIA disclosure pattern).
 */
export function useDisclosure<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<T>(null);
  const close = useCallback((returnFocus = true) => { setOpen(false); if (returnFocus) trigger.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('input, select, button, [href], [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open, close]);
  return { open, setOpen, toggle: () => setOpen(o => !o), close, triggerProps: { ref: trigger, 'aria-expanded': open }, panelRef: panel };
}
