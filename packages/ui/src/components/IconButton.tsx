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
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children' | 'title'
> {
  /** The button's name for assistive tech, also shown as its tooltip. */
  readonly label: string;
  readonly icon: ReactNode;
}

/**
 * A button with only an icon. Its label shows as a tooltip on mouse hover and keyboard focus
 * (Floating UI, like InfoTip), and is the button's accessible name. Touch needs nothing more:
 * a tap does what the button does, and the tooltip only repeats its name.
 */
export function IconButton({ label, icon, className, ...props }: IconButtonProps) {
  const [open, setOpen] = useState(false);
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { mouseOnly: true, delay: { open: 400, close: 0 } }),
    useFocus(context, { visibleOnly: true }),
    useDismiss(context),
  ]);

  return (
    <>
      <button
        ref={setReference}
        type="button"
        className={className ? `icon-button ${className}` : 'icon-button'}
        aria-label={label}
        {...getReferenceProps(props)}
      >
        {icon}
      </button>
      {open && (
        <FloatingPortal>
          {/* It only repeats the button's name, so it isn't linked to it for assistive tech. */}
          <div
            ref={setFloating}
            className="info-tip"
            aria-hidden="true"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/** A chevron pointing up (to fold something away) or down (to unfold it). */
export function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** An "X", for removing or clearing. */
export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
