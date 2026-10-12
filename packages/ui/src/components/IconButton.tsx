import type { ButtonHTMLAttributes, HTMLProps, ReactNode } from 'react';
import { useTooltip } from './Tooltip.tsx';

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
 * (useTooltip), and is the button's accessible name. Touch needs nothing more:
 * a tap does what the button does, and the tooltip only repeats its name.
 */
export function IconButton({ label, icon, className, ...props }: IconButtonProps) {
  const { setReference, getReferenceProps, tooltip } = useTooltip(label);
  return (
    <>
      <button
        ref={setReference}
        type="button"
        className={className ? `icon-button ${className}` : 'icon-button'}
        aria-label={label}
        {...getReferenceProps(props as HTMLProps<Element>)}
      >
        {icon}
      </button>
      {tooltip}
    </>
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

/** A gear, for settings. */
export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M6.9 1.5h2.2l.35 1.75a5 5 0 0 1 1.3.75l1.7-.57 1.1 1.9-1.35 1.18a5 5 0 0 1 0 1.5l1.35 1.18-1.1 1.9-1.7-.57a5 5 0 0 1-1.3.75L9.1 14.5H6.9l-.35-1.75a5 5 0 0 1-1.3-.75l-1.7.57-1.1-1.9 1.35-1.18a5 5 0 0 1 0-1.5L2.45 6.8l1.1-1.9 1.7.57a5 5 0 0 1 1.3-.75z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
