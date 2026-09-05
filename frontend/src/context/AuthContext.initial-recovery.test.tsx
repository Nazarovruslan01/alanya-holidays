import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api-client', () => ({
  apiClient: { post: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../components/base/PageHeroImage', () => ({
  default: () => <div data-testid="hero-image" />,
}));

const recoveryUser = {
  id: 'real-auth-js-recovery-user',
  email: 'recovery@example.com',
  user_metadata: {},
  app_metadata: {},
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-09-02T00:00:00.000Z',
};

function installSupabaseHttpStub() {
  const requests: Array<{ method: string; pathname: string }> = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    requests.push({
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      pathname: requestUrl.pathname,
    });

    if (requestUrl.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify(recoveryUser), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (requestUrl.pathname === '/rest/v1/profiles') {
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (requestUrl.pathname === '/auth/v1/logout') {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected Supabase request: ${requestUrl.pathname}`);
  });

  vi.stubGlobal('fetch', fetchStub);
  return requests;
}

describe('AuthProvider with the real auth-js callback lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps the password form usable when auth-js re-emits SIGNED_IN for the recovery session', async () => {
    const requests = installSupabaseHttpStub();
    let visibilityState: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    window.history.replaceState(
      {},
      '',
      '/reset-password#type=recovery&access_token=test-access-token&refresh_token=test-refresh-token&expires_in=3600&token_type=bearer'
    );

    const supabaseModule = await import('../lib/supabase');
    expect(supabaseModule.initialPasswordRecoveryIntent).toBe(true);

    await supabaseModule.supabase.auth.initialize();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.hash).toBe('');

    const { AuthProvider } = await import('./AuthContext');
    const { default: ResetPasswordPage } = await import('../pages/reset-password/page');

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/reset-password']}>
          <AuthProvider>
            <Routes>
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/login" element={<div>Sign-in destination</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>
    );

    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByLabelText('New password')).toBeInTheDocument();

    visibilityState = 'hidden';
    window.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    visibilityState = 'visible';
    window.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByLabelText('New password')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-secure-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new-secure-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText('Sign-in destination')).toBeInTheDocument();
    expect(requests).toContainEqual({ method: 'PUT', pathname: '/auth/v1/user' });
    expect(requests).toContainEqual({ method: 'POST', pathname: '/auth/v1/logout' });

    await supabaseModule.supabase.auth.stopAutoRefresh();
  });
});
