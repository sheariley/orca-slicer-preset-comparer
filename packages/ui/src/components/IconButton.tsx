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
