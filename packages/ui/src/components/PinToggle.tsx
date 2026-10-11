import type { HTMLProps } from 'react';
import { useTooltip } from './Tooltip.tsx';

interface PinToggleProps {
  /** The button's accessible name, e.g. "Pin override for Nozzle temperature". */
  readonly label: string;
  readonly pinned: boolean;
  readonly onChange: (pinned: boolean) => void;
  /** The tooltip for each state, e.g. "Pinned: keeps its own value". */
  readonly pinnedText: string;
  readonly unpinnedText: string;
}

/**
 * A toggle button drawn as a thumbtack: upright and filled when pinned, tilted and outlined
 * when not. Its name stays the same and `aria-pressed` carries the state; its tooltip
 * (useTooltip) says what the current state means.
 */
export function PinToggle({ label, pinned, onChange, pinnedText, unpinnedText }: PinToggleProps) {
  const { setReference, getReferenceProps, tooltip } = useTooltip(
    pinned ? pinnedText : unpinnedText,
  );
  return (
    <>
      <button
        ref={setReference}
        type="button"
        className="icon-button pin-toggle"
        aria-label={label}
        aria-pressed={pinned}
        {...getReferenceProps({ onClick: () => onChange(!pinned) } as HTMLProps<Element>)}
      >
        <ThumbtackIcon pinned={pinned} />
      </button>
      {tooltip}
    </>
  );
}

function ThumbtackIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M5.5 1.75h5v1.5l-1 1v3.25l2.25 2.25v1.25h-3v3.5L8 15l-.75-1v-3.5h-3V9.25L6.5 7.5V4.25l-1-1z"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        transform={pinned ? undefined : 'rotate(40 8 8)'}
      />
    </svg>
  );
}
