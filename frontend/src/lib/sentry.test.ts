import * as Sentry from '@sentry/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initSentry } from './sentry';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'browser-tracing' })),
  replayIntegration: vi.fn(() => ({ name: 'replay' })),
}));

describe('initSentry auth callback privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.unstubAllEnvs();
  });

  it('does not initialize telemetry when the initial fragment contains auth secrets', () => {
    window.history.replaceState(
      {},
      '',
      '/reset-password#access_token=secret&refresh_token=secret&provider_token=secret&provider_refresh_token=secret'
    );

    initSentry();

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.replayIntegration).not.toHaveBeenCalled();
  });

  it('does not initialize telemetry when the initial query contains an auth code or token hash', () => {
    window.history.replaceState(
      {},
      '',
      '/reset-password?code=secret&token=secret&token_hash=secret'
    );

    initSentry();

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.replayIntegration).not.toHaveBeenCalled();
  });

  it('initializes telemetry unchanged for an ordinary URL with only similar parameter names', () => {
    window.history.replaceState(
      {},
      '',
      '/travel-guides?access_token_hint=public&mycode=promo#tokenized=true'
    );

    initSentry();

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.browserTracingIntegration).toHaveBeenCalledTimes(1);
    expect(Sentry.replayIntegration).toHaveBeenCalledTimes(1);
  });
});
