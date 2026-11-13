// This module intentionally has no network/SDK imports or configurable endpoint.
const registered = new WeakSet<object>();
export class NoCharge extends Error {}
export class UnknownOutcome extends Error {}
export class FakeProvider {
  readonly kind = 'deterministic-fake';
  calls = 0;
  constructor(
    readonly mode: 'success' | 'rejected' | 'unknown' | 'timeout' = 'success',
    readonly delayMs = 0,
  ) {
    registered.add(this);
  }
  async complete(input: { estimatedInputTokens: number; maxOutputTokens: number }) {
    this.calls++;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.mode === 'rejected') throw new NoCharge('FAKE_REJECTED_NO_CHARGE');
    if (this.mode === 'unknown') throw new UnknownOutcome('FAKE_OUTCOME_UNKNOWN');
    if (this.mode === 'timeout') return new Promise<never>(() => {});
    return {
      content: '模拟 AI 费用测试回复；未调用真实模型。',
      inputTokens: input.estimatedInputTokens,
      outputTokens: Math.min(3, input.maxOutputTokens),
      simulated: true as const,
    };
  }
}
export function assertFake(provider: FakeProvider) {
  if (!registered.has(provider)) throw new Error('REAL_PROVIDER_DISABLED');
}
export function realProvider(): never {
  throw new Error('REAL_PROVIDER_NOT_IMPLEMENTED_NO_KEY_ACCEPTED');
}
