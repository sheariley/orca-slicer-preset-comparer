import { presetIn, type EditSession } from '@comparer/app';
import type { TargetPlan } from '@comparer/core';
import { useMemo } from 'react';
import { InfoTip } from '../../components/InfoTip.tsx';
import { useComparerApp } from '../../hooks/useComparerApp.ts';
import { formatValue, settingNames } from '../diff-view/format.ts';
import { skipReasonText } from './skip-reasons.ts';

interface CopyPlanTableProps {
  /** The session before the copy, and with it recorded (to show each value now and after). */
  readonly before: EditSession;
  readonly after: EditSession;
  readonly source: string;
  readonly plan: TargetPlan;
  readonly keys: readonly string[];
  /** Records a "Pin override" choice; the plan already reflects earlier ones. */
  readonly onPin: (key: string, keep: boolean) => void;
  /**
   * Added to each checkbox's accessible name when several tables share a dialog (e.g.
   * " in PETG"), so the names stay unique.
   */
  readonly nameSuffix?: string;
}

/**
 * What a copy does to one target: each setting's value now and after, why any are left alone,
 * and a "Pin override" checkbox for each redundant override.
 */
export function CopyPlanTable({
  before,
  after,
  source,
  plan,
  keys,
  onPin,
  nameSuffix = '',
}: CopyPlanTableProps) {
  const app = useComparerApp();
  const target = plan.target.id;
  const targetName = plan.target.name;
  const parent = presetIn(before, target).chain[1]?.ref.name;
  const parentText = parent ? `"${parent}"` : "OrcaSlicer's built-in default";

  const values = useMemo(() => {
    const valuesIn = (state: EditSession) =>
      new Map(app.compareEdited(state, source, target).rows.map((row) => [row.key, row.right]));
    return { before: valuesIn(before), after: valuesIn(after) };
  }, [app, before, after, source, target]);

  const skipped = new Map(plan.skipped.map((skip) => [skip.key, skip.reason]));
  const redundant = new Map(plan.redundantOverrides.map((item) => [item.key, item.keep]));
  const names = settingNames(keys, (key) => app.describeSetting(key)?.label ?? key);

  return (
    <table className="preview-table">
      <thead>
        <tr>
          <th scope="col">Setting</th>
          <th scope="col">Now</th>
          <th scope="col">After</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => {
          const info = app.describeSetting(key);
          const label = info?.label ?? key;
          const reason = skipped.get(key);
          const keep = redundant.get(key);
          const pinName = `Pin override for ${names.get(key) ?? label}${nameSuffix}`;
          return (
            <tr key={key} data-skipped={reason !== undefined && keep === undefined}>
              <th scope="row">
                {label}
                {label !== key && <code className="setting-key">{key}</code>}
              </th>
              <td>{formatValue(values.before.get(key), info?.unit)}</td>
              <td>{formatValue(values.after.get(key), info?.unit)}</td>
              <td>
                {keep !== undefined ? (
                  <span className="toggle">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        aria-label={pinName}
                        checked={keep}
                        onChange={(event) => onPin(key, event.target.checked)}
                      />
                      Pin override
                    </label>
                    <InfoTip
                      subject={pinName}
                      content={
                        <>
                          <p>
                            After the copy, {targetName} would set the same value it inherits from{' '}
                            {parentText}.
                          </p>
                          <p>
                            Checked: {targetName} keeps its own value, so later changes to{' '}
                            {parentText} no longer reach it.
                          </p>
                          <p>Unchecked: the setting is re-linked to {parentText} and follows it.</p>
                        </>
                      }
                    />
                  </span>
                ) : (
                  reason !== undefined && skipReasonText(reason, targetName)
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
