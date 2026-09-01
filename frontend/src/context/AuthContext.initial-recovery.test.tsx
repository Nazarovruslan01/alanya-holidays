import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const recoveryUser = {
    id: 'pre-client-recovery-user',
    email: 'pre-client-recovery@example.com',
    user_metadata: {},
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2026-09-02T00:00:00.000Z',
  };
  const recoverySession = {
    access_token: 'test-session-access-token',
    refresh_token: 'test-session-refresh-token',
    expires_in: 3600,
    token_type: 'bearer' as const,
    user: recoveryUser,
  };
  const authStateCallback = {
    current: undefined as
      | ((event: string, session: typeof recoverySession | null) => void | Promise<void>)
      | undefined,
  };
  const client = {
    auth: {
      initialize: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: recoverySession },
        error: null,
      }),
      onAuthStateChange: vi.fn((callback) => {
        authStateCallback.current = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  };

  return {
    authStateCallback,
    client,
    createClient: vi.fn(() => {
      window.history.replaceState({}, '', '/reset-password');
      return client;
    }),
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: harness.createClient,
}));

vi.mock('../lib/api-client', () => ({
  apiClient: { post: vi.fn().mockResolvedValue({}) },
}));

describe('AuthProvider pre-client recovery capture', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    harness.authStateCallback.current = undefined;
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'dummy');
  });

  it('restores readiness after createClient clears the callback before React subscribes', async () => {
    window.history.replaceState(
      {},
      '',
      '/reset-password#type=recovery&access_token=placeholder&refresh_token=placeholder&expires_in=3600&token_type=bearer'
    );

    const { AuthProvider, useAuth } = await import('./AuthContext');
    expect(window.location.hash).toBe('');

    function RecoveryState() {
      return <div>{useAuth().passwordRecoveryStatus}</div>;
    }

    render(
      <AuthProvider>
        <RecoveryState />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(harness.createClient).toHaveBeenCalledTimes(1);
    expect(harness.authStateCallback.current).toBeDefined();
  });
});
