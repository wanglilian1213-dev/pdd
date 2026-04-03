export type PollStage = 'outline' | 'writing' | 'humanize';

const POLL_DELAY_MS: Record<PollStage, { initial: number; increment: number; max: number }> = {
  outline: { initial: 3000, increment: 2000, max: 15000 },
  writing: { initial: 5000, increment: 3000, max: 15000 },
  humanize: { initial: 5000, increment: 3000, max: 15000 },
};

const POLL_TIMEOUT_MS: Record<PollStage, number> = {
  outline: 10 * 60 * 1000,
  // Writing now allows a much longer server-side chain, so the UI must not give up early.
  writing: 3 * 60 * 60 * 1000,
  humanize: 20 * 60 * 1000,
};

export function getPollDelayMs(stage: PollStage, attempt: number) {
  const config = POLL_DELAY_MS[stage];
  return Math.min(config.initial + attempt * config.increment, config.max);
}

export function getPollTimeoutMs(stage: PollStage) {
  return POLL_TIMEOUT_MS[stage];
}

export function hasPollingTimedOut(stage: PollStage, startedAt: number, now = Date.now()) {
  return now - startedAt >= getPollTimeoutMs(stage);
}
