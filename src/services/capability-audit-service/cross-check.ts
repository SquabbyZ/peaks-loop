import type { CrossCheck } from './types.js';

export function crossCheck(input: {
  readonly guardPass: number;     readonly guardFail: number;
  readonly independentPass: number; readonly independentFail: number;
  readonly karpathy: 'pass' | 'warn' | 'fail' | 'skipped';
}): CrossCheck {
  const guardVerdict = input.guardFail === 0 ? 'pass' : 'fail';
  const indepVerdict  = input.independentFail === 0 ? 'pass' : 'fail';
  const guardVsAudit =
    guardVerdict === indepVerdict ? 'agree'
      : (Math.abs(input.guardPass - input.independentPass) <= 1) ? 'partial'
        : 'diverge';
  const karpathyVsAudit =
    input.karpathy === 'skipped' ? 'partial'
      : (input.karpathy === 'warn' ? 'partial'
        : (input.karpathy === 'pass' ? guardVsAudit : 'diverge'));
  return { guardVsAudit, karpathyVsAudit };
}
