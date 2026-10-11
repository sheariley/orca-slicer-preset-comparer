import { useCallback, useEffect, useRef, useState } from 'react';
import { useComparerApp } from './useComparerApp.ts';

/**
 * A remembered user preference (see Preferences in app): `fallback` until the saved value loads,
 * then the saved value if `isValid` accepts it. Setting it saves it. A change made before the
 * saved value arrives wins over it.
 */
export function usePreference<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const app = useComparerApp();
  const [value, setValue] = useState(fallback);
  const changed = useRef(false);

  useEffect(() => {
    let current = true;
    void app.preferences.load().then((saved) => {
      const stored = saved[key];
      if (current && !changed.current && isValid(stored)) setValue(stored);
    });
    return () => {
      current = false;
    };
    // `isValid` is a type guard that doesn't change meaning between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, key]);

  const set = useCallback(
    (next: T) => {
      changed.current = true;
      setValue(next);
      void app.preferences.set(key, next);
    },
    [app, key],
  );
  return [value, set];
}

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
