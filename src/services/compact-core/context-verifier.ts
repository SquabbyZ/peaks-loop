export interface ContextMeasurement {
  readonly ratio: number;
}

export interface ContextReductionVerification {
  readonly passed: boolean;
  readonly requiredMaximum: number;
}

export function verifyContextReduction(input: {
  readonly before: ContextMeasurement;
  readonly after: ContextMeasurement;
  readonly targetRatio?: number;
}): ContextReductionVerification {
  assertRatio('before.ratio', input.before.ratio);
  assertRatio('after.ratio', input.after.ratio);
  if (input.targetRatio !== undefined) {
    assertRatio('targetRatio', input.targetRatio);
  }

  const requiredMaximum = Math.min(
    input.before.ratio * 0.7,
    input.targetRatio ?? 0.6
  );
  return {
    passed: input.after.ratio < requiredMaximum,
    requiredMaximum
  };
}

function assertRatio(label: string, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`${label} must be a finite ratio in [0, 1]`);
  }
}
