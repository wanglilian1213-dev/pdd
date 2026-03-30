import * as Sentry from '@sentry/node';
import { env } from './runtimeEnv';

let sentryEnabled = false;

export function initErrorMonitor() {
  if (!env.sentryDsn || sentryEnabled) {
    return;
  }

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: 0,
  });

  sentryEnabled = true;
}

export function captureError(error: unknown, context: string, extra?: Record<string, unknown>) {
  console.error(`[monitor] ${context}`, error, extra);

  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag('context', context);
    if (extra) {
      scope.setExtras(extra);
    }
    Sentry.captureException(error);
  });
}
