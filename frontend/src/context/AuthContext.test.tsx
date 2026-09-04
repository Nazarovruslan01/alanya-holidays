import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

const authStateHarness = vi.hoisted(() => ({
  initialRecoveryIntent: false,
  callback: undefined as
    | ((event: AuthChangeEvent, session: Session | null) => void | Promise<void>)
    | undefined,
}));

vi.mock('../lib/supabase', () => {
  return {
    get initialPasswordRecoveryIntent() {
      return authStateHarness.initialRecoveryIntent;
    },
    supabase: {
      auth: {
        initialize: vi.fn(),
        getSession: vi.fn(),
        onAuthStateChange: vi.fn(
          (
            callback: (event: AuthChangeEvent, session: Session | null) =>
              | void
              | Promise<void>
          ) => {
            authStateHarness.callback = callback;
            return {
              data: { subscription: { unsubscribe: vi.fn() } },
            };
          }
        ),
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        signInWithOAuth: vi.fn(),
        updateUser: vi.fn(),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      })),
    },
  };
});

vi.mock('../lib/api-client', () => ({
  apiClient: { post: vi.fn().mockResolvedValue({}) },
}));

const TestConsumer: React.FC = () => {
  const { user, loading, isAuthenticated, signIn, signOut } = useAuth();

  if (loading) return <div>Loading Auth...</div>;

  return (
    <div>
      <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'unauthenticated'}</div>
      <div data-testid="user-email">{user?.email || 'no-email'}</div>
      <button onClick={() => signIn('test@example.com', 'password123')}>Sign In</button>
      <button onClick={() => signOut()}>Sign Out</button>
    </div>
  );
};

const SignUpConsumer: React.FC = () => {
  const { signUp } = useAuth();
  return (
    <button
      onClick={() => signUp({
        email: ' business@example.com ',
        password: 'password123',
        fullName: 'Business Owner',
        metadata: { registration_path: 'business' },
        emailRedirectTo: 'https://example.com/base/business/dashboard',
      })}
    >
      Sign Up
    </button>
  );
};

const PasswordAndProfileConsumer: React.FC = () => {
  const { profile, updatePassword, updateProfile } = useAuth();

  return (
    <div>
      <div data-testid="profile-name">{profile?.full_name || 'no-profile'}</div>
      <div data-testid="profile-bio">{profile?.bio || 'no-bio'}</div>
      <button
        onClick={async () => {
          await updatePassword('new-secure-pass-123');
        }}
      >
        Change Password
      </button>
      <button
        onClick={async () => {
          await updateProfile({
            full_name: 'Alex Rivera Updated',
            bio: 'Living in Alanya',
          });
        }}
      >
        Update Profile
      </button>
    </div>
  );
};

const PasswordRecoveryConsumer: React.FC = () => {
  const {
    passwordRecoveryStatus,
    resetPassword,
    completePasswordRecovery,
  } = useAuth();
  const [result, setResult] = React.useState('');

  return (
    <div>
      <div data-testid="recovery-status">{passwordRecoveryStatus}</div>
      <div data-testid="recovery-result">{result}</div>
      <button onClick={() => resetPassword(' reset@example.com ')}>
        Request reset
      </button>
      <button
        onClick={async () => {
          const { error } = await completePasswordRecovery('new-password-123');
          setResult(error?.message ?? 'success');
        }}
      >
        Complete reset
      </button>
    </div>
  );
};

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStateHarness.initialRecoveryIntent = false;
    authStateHarness.callback = undefined;
    vi.stubGlobal('__BASE_PATH__', process.env.BASE_PATH || '/');
    window.history.replaceState({}, '', '/');
    (supabase.auth.initialize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: null,
    });
    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });

  it('throws error when useAuth is used outside AuthProvider', () => {
    const ComponentOutside = () => {
      useAuth();
      return null;
    };

    expect(() => render(<ComponentOutside />)).toThrow(
      'useAuth must be used within an AuthProvider'
    );
  });

  it('provides unauthenticated state when no session exists', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    const statusEl = await screen.findByTestId('auth-status');
    expect(statusEl.textContent).toBe('unauthenticated');
    expect(screen.getByTestId('user-email').textContent).toBe('no-email');
  });

  it('provides authenticated user when active session exists', async () => {
    const mockUser = {
      id: 'usr_123',
      email: 'alex@example.com',
      user_metadata: { full_name: 'Alex Rivera' },
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        session: {
          access_token: 'fake-jwt',
          user: mockUser,
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    const statusEl = await screen.findByTestId('auth-status');
    expect(statusEl.textContent).toBe('authenticated');
    expect(screen.getByTestId('user-email').textContent).toBe('alex@example.com');
  });

  it('calls signIn on supabase client when invoked', async () => {
    (supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        user: { id: 'usr_123', email: 'test@example.com' },
        session: { access_token: 'fake-jwt', user: { id: 'usr_123', email: 'test@example.com' } },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await screen.findByTestId('auth-status');

    await act(async () => {
      screen.getByText('Sign In').click();
    });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('passes signup metadata and email confirmation destination exactly to Supabase', async () => {
    (supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    render(
      <AuthProvider>
        <SignUpConsumer />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText('Sign Up').click();
    });

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'business@example.com',
      password: 'password123',
      options: {
        data: {
          full_name: 'Business Owner',
          registration_path: 'business',
        },
        emailRedirectTo: 'https://example.com/base/business/dashboard',
      },
    });
  });

  it('calls updatePassword on supabase.auth.updateUser and returns clean result', async () => {
    (supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { id: 'usr_123' } },
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordAndProfileConsumer />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText('Change Password').click();
    });

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      password: 'new-secure-pass-123',
    });
  });

  it('sends password recovery emails to the reset page under the configured app base path', async () => {
    (supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {},
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText('Request reset').click();
    });

    if (__BASE_PATH__ !== '/' && __BASE_PATH__ !== '/alanya/') {
      throw new Error(`Unexpected BASE_PATH in password recovery test matrix: ${__BASE_PATH__}`);
    }
    const expectedRedirectTo =
      __BASE_PATH__ === '/'
        ? `${window.location.origin}/reset-password`
        : `${window.location.origin}/alanya/reset-password`;

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'reset@example.com',
      { redirectTo: expectedRedirectTo }
    );
  });

  it('permits password replacement only after a PASSWORD_RECOVERY event and ends that session locally', async () => {
    const recoveryUser = {
      id: 'recovery-user',
      email: 'recover@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    const recoverySession = {
      access_token: 'test-recovery-access-token',
      refresh_token: 'test-recovery-refresh-token',
      expires_in: 3600,
      token_type: 'bearer' as const,
      user: recoveryUser,
    };
    (supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: recoveryUser },
      error: null,
    });
    (supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(authStateHarness.callback).toBeDefined());
    await act(async () => {
      await authStateHarness.callback?.('PASSWORD_RECOVERY', recoverySession);
    });

    expect(screen.getByTestId('recovery-status')).toHaveTextContent('ready');

    await act(async () => {
      screen.getByText('Complete reset').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('recovery-result')).toHaveTextContent('success');
    });
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      password: 'new-password-123',
    });
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('recovery-status')).toHaveTextContent('invalid');
  });

  it('recovers a valid initial callback session when PASSWORD_RECOVERY fired before React subscribed', async () => {
    const recoveryUser = {
      id: 'initial-recovery-user',
      email: 'initial-recovery@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    const recoverySession = {
      access_token: 'initial-test-access-token',
      refresh_token: 'initial-test-refresh-token',
      expires_in: 3600,
      token_type: 'bearer' as const,
      user: recoveryUser,
    };
    window.history.replaceState(
      {},
      '',
      '/reset-password#access_token=placeholder&refresh_token=placeholder&expires_in=3600&token_type=bearer&type=recovery'
    );
    authStateHarness.initialRecoveryIntent = true;
    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: recoverySession },
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('recovery-status')).toHaveTextContent('ready');
    });
    expect(authStateHarness.callback).toBeDefined();
  });

  it('keeps an ordinary initial session invalid without an initial recovery callback', async () => {
    const ordinaryUser = {
      id: 'ordinary-initial-user',
      email: 'ordinary-initial@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        session: {
          access_token: 'ordinary-initial-access-token',
          refresh_token: 'ordinary-initial-refresh-token',
          expires_in: 3600,
          token_type: 'bearer' as const,
          user: ordinaryUser,
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('recovery-status')).toHaveTextContent('invalid');
    });
  });

  it('does not authorize a bare recovery marker or similar non-secret parameter names', async () => {
    const ordinaryUser = {
      id: 'marker-user',
      email: 'marker@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    window.history.replaceState(
      {},
      '',
      '/reset-password#type=recovery&access_token_hint=placeholder&refresh_token_hint=placeholder'
    );
    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        session: {
          access_token: 'marker-access-token',
          refresh_token: 'marker-refresh-token',
          expires_in: 3600,
          token_type: 'bearer' as const,
          user: ordinaryUser,
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('recovery-status')).toHaveTextContent('invalid');
    });
  });

  it('does not authorize exact recovery parameter names when secret values are absent', async () => {
    const ordinaryUser = {
      id: 'empty-marker-user',
      email: 'empty-marker@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    window.history.replaceState(
      {},
      '',
      '/reset-password#type=recovery&access_token=&refresh_token=&expires_in=3600&token_type=bearer'
    );
    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        session: {
          access_token: 'ordinary-access-token',
          refresh_token: 'ordinary-refresh-token',
          expires_in: 3600,
          token_type: 'bearer' as const,
          user: ordinaryUser,
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('recovery-status')).toHaveTextContent('invalid');
    });
  });

  it('does not authorize an existing session when Supabase rejects the initial recovery callback', async () => {
    const ordinaryUser = {
      id: 'rejected-callback-user',
      email: 'rejected-callback@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    window.history.replaceState(
      {},
      '',
      '/reset-password#type=recovery&access_token=placeholder&refresh_token=placeholder&expires_in=3600&token_type=bearer'
    );
    authStateHarness.initialRecoveryIntent = true;
    (supabase.auth.initialize as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: new Error('Invalid recovery callback'),
    });
    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        session: {
          access_token: 'existing-access-token',
          refresh_token: 'existing-refresh-token',
          expires_in: 3600,
          token_type: 'bearer' as const,
          user: ordinaryUser,
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('recovery-status')).toHaveTextContent('invalid');
    });
  });

  it('rejects password replacement for an ordinary authenticated session', async () => {
    const ordinaryUser = {
      id: 'ordinary-user',
      email: 'ordinary@example.com',
      user_metadata: {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    const ordinarySession = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
      token_type: 'bearer' as const,
      user: ordinaryUser,
    };

    render(
      <AuthProvider>
        <PasswordRecoveryConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(authStateHarness.callback).toBeDefined());
    await act(async () => {
      await authStateHarness.callback?.('SIGNED_IN', ordinarySession);
    });
    await act(async () => {
      screen.getByText('Complete reset').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('recovery-result')).toHaveTextContent(
        'Password recovery session is invalid or expired.'
      );
    });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('updates profile and reactively updates state', async () => {
    const mockUser = {
      id: 'usr_123',
      email: 'alex@example.com',
      user_metadata: { full_name: 'Alex Rivera' },
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    (supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        session: {
          access_token: 'fake-jwt',
          user: mockUser,
        },
      },
      error: null,
    });

    const initialProfileData = {
      id: 'usr_123',
      email: 'alex@example.com',
      full_name: 'Alex Rivera',
      bio: null,
      role: 'user',
      avatar_url: null,
      phone: null,
      company_name: null,
      iban: null,
      bank_name: null,
      bank_account_holder_name: null,
      crypto_wallet: null,
      social_links: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updatedProfileData = {
      id: 'usr_123',
      email: 'alex@example.com',
      full_name: 'Alex Rivera Updated',
      bio: 'Living in Alanya',
      role: 'user',
      avatar_url: null,
      phone: null,
      company_name: null,
      iban: null,
      bank_name: null,
      bank_account_holder_name: null,
      crypto_wallet: null,
      social_links: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: initialProfileData, error: null }),
          single: vi.fn().mockResolvedValue({ data: initialProfileData, error: null }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: updatedProfileData, error: null }),
          })),
        })),
      })),
    });

    render(
      <AuthProvider>
        <PasswordAndProfileConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Alex Rivera');
    });

    await act(async () => {
      screen.getByText('Update Profile').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Alex Rivera Updated');
      expect(screen.getByTestId('profile-bio')).toHaveTextContent('Living in Alanya');
    });
  });
});
