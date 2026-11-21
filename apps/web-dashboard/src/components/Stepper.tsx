import React from 'react';
import { Icon } from './Icon';

/** Progress through a flow. The current step is marked for assistive technology with aria-current="step". */
export function Stepper({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return <li key={s} className={'step ' + state} aria-current={state === 'current' ? 'step' : undefined}>
          <span className="num" aria-hidden="true">{state === 'done' ? <Icon name="check" size={12} /> : i + 1}</span>
          {s}{state === 'done' && <span className="sr-only"> (done)</span>}
        </li>;
      })}
    </ol>
  );
}
