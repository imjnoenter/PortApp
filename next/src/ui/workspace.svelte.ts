// What the symbol workspace's two halves share: the forms on the right write their unsaved figures
// here, and the chart on the left draws them, so a line moves as a number is typed.
import type { Plan } from '../core/plan.ts';
import type { Level } from './parts/PriceChart.svelte';

export const WORKSPACE = 'workspace';

export class Workspace {
  symbol = $state('');
  portfolio = $state('');
  /** Average cost after the trade being typed, or after every buy in the plan being edited. */
  newAvg = $state<number | null>(null);
  /** Shares held after the trade being typed, so the target bar can show where it would leave the position. */
  newQty = $state<number | null>(null);
  /** What the position would be worth, in the target's own dollars, once the plan being edited has run. */
  planValue = $state<number | null>(null);
  /** The plan as edited so far, before it is saved. */
  plan = $state.raw<Plan | null>(null);
}

/** The horizontal lines for one holding: its cost, the cost a trade would leave, and every level of its plan. */
export function planLevels(t: (s: string) => string, avg: number | null | undefined, plan: Plan | null | undefined, newAvg?: number | null): Level[] {
  const out: Level[] = [];
  if (avg && avg > 0) out.push({ label: t('Avg cost'), value: avg, tone: 'avg' });
  if (newAvg && newAvg > 0 && (!avg || Math.abs(newAvg - avg) > 0.005)) out.push({ label: t('New avg'), value: newAvg, tone: 'new' });
  if (plan) {
    plan.trims.forEach((x, i) => { if (x.price) out.push({ label: `${t('Take profit')} ${i + 1}`, value: x.price, tone: 'profit' }); });
    plan.tranches.forEach((x, i) => { if (x.price) out.push({ label: `${t('Buy')} ${i + 1}`, value: x.price, tone: 'entry' }); });
    if (plan.sl) out.push({ label: t('Stop loss'), value: plan.sl, tone: 'stop' });
  }
  return out;
}
