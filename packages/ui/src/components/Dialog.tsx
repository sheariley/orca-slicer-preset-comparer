import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useId,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { ReactNode, RefObject } from 'react';

interface DialogProps {
  readonly title: string;
  readonly children: ReactNode;
  /** The buttons at the bottom; the primary action goes last. */
  readonly actions: ReactNode;
  /** Called on Escape or a click on the backdrop. Omit it to make the dialog stay open. */
  readonly onClose?: () => void;
  /** Where focus starts; by default, the first focusable element. */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /** A wider dialog, for content that needs the room (e.g. bulk copy). */
  readonly wide?: boolean;
}

/*
 * A modal dialog on @floating-ui/react (already used by InfoTip): FloatingFocusManager traps
 * focus and restores it on close, useRole adds the dialog semantics, and useDismiss handles
 * Escape. A backdrop click closes it through the overlay itself rather than useDismiss's
 * outside press, so clicking an InfoTip's tip (portaled outside the dialog) doesn't close it.
 * Render it only while open.
 */
export function Dialog({ title, children, actions, onClose, initialFocus, wide }: DialogProps) {
  const titleId = useId();
  const {
    refs: { setFloating },
    context,
  } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose?.();
    },
  });
  const { getFloatingProps } = useInteractions([
    useDismiss(context, { enabled: onClose !== undefined, outsidePress: false }),
    useRole(context, { role: 'dialog' }),
  ]);

  return (
    <FloatingPortal>
      <FloatingOverlay
        className="dialog-overlay"
        lockScroll
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <FloatingFocusManager context={context} modal initialFocus={initialFocus ?? 0}>
          <div
            ref={setFloating}
            className={wide ? 'dialog dialog-wide' : 'dialog'}
            aria-modal="true"
            aria-labelledby={titleId}
            {...getFloatingProps()}
          >
            <h2 id={titleId}>{title}</h2>
            <div className="dialog-body">{children}</div>
            <div className="dialog-actions">{actions}</div>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
