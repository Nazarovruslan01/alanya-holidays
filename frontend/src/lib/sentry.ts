import * as Sentry from '@sentry/react';

const AUTH_SECRET_PARAMETERS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'code',
  'token',
  'token_hash',
]);

function containsAuthSecretParameter(value: string): boolean {
  if (!value) {
    return false;
  }

  const withoutPrefix = value.startsWith('?') || value.startsWith('#')
    ? value.slice(1)
    : value;
  const queryStart = withoutPrefix.indexOf('?');
  const parameterStrings = queryStart >= 0
    ? [withoutPrefix, withoutPrefix.slice(queryStart + 1)]
    : [withoutPrefix];

  return parameterStrings.some((parameterString) => {
    const parameters = new URLSearchParams(parameterString);
    return [...parameters.keys()].some((key) => AUTH_SECRET_PARAMETERS.has(key));
  });
}

function hasAuthSecretsInInitialUrl(): boolean {
  return typeof window !== 'undefined' && (
    containsAuthSecretParameter(window.location.search) ||
    containsAuthSecretParameter(window.location.hash)
  );
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || dsn.trim() === '') {
    return;
  }

  // Supabase consumes auth callback secrets from the initial URL asynchronously.
  // Do not start tracing or Replay until a later page load after those secrets are gone.
  if (hasAuthSecretsInInitialUrl()) {
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE || 'development',
      release: import.meta.env.VITE_APP_VERSION || '0.0.1',
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  } catch (error) {
    console.warn(
      'Failed to initialize Sentry on frontend:',
      error instanceof Error ? error.message : String(error),
    );
  }
}
