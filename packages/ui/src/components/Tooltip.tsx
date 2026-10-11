import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import { useState, type HTMLProps, type ReactNode } from 'react';

/**
 * A plain text tooltip for a button (Floating UI, like InfoTip): it shows on mouse hover and
 * keyboard focus, and `show()` opens it on demand (e.g. when a click can't do anything yet).
 * Without `text`, there's no tooltip. It's never the only place its text lives: the button's
 * name or description carries it for assistive tech, so the tip itself is hidden from it.
 */
export function useTooltip(text: string | undefined): {
  readonly setReference: (node: HTMLElement | null) => void;
  readonly getReferenceProps: (props?: HTMLProps<Element>) => Record<string, unknown>;
  readonly show: () => void;
  readonly tooltip: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context,
  } = useFloating({
    open: open && text !== undefined,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const enabled = text !== undefined;
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { enabled, mouseOnly: true, delay: { open: 400, close: 0 } }),
    useFocus(context, { enabled, visibleOnly: true }),
    useDismiss(context, { enabled }),
  ]);

  return {
    setReference,
    getReferenceProps,
    show: () => setOpen(true),
    tooltip:
      open && text !== undefined ? (
        <FloatingPortal>
          <div
            ref={setFloating}
            className="info-tip"
            aria-hidden="true"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {text}
          </div>
        </FloatingPortal>
      ) : null,
  };
}
