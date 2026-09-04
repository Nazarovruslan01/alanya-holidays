import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResetPasswordPage from './page';

const authHarness = vi.hoisted(() => ({
  status: 'checking' as 'checking' | 'ready' | 'invalid',
  completePasswordRecovery: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    passwordRecoveryStatus: authHarness.status,
    completePasswordRecovery: authHarness.completePasswordRecovery,
  }),
}));

vi.mock('@/components/base/PageHeroImage', () => ({
  default: () => <div data-testid="hero-image" />,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Sign-in destination</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    authHarness.status = 'checking';
    authHarness.completePasswordRecovery.mockReset();
  });

  it('waits for Supabase to validate the recovery callback before showing the form', () => {
    renderPage();

    expect(screen.getByText('Checking reset link…')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('shows a safe retry path for an invalid or expired recovery link', () => {
    authHarness.status = 'invalid';
    renderPage();

    expect(screen.getByText('Reset link unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('This password reset link is invalid or has expired.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request another reset link' })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('validates password length and confirmation without calling Supabase', async () => {
    authHarness.status = 'ready';
    renderPage();

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password must be at least 8 characters.'
    );
    expect(authHarness.completePasswordRecovery).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'strong-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Passwords don't match.");
    expect(authHarness.completePasswordRecovery).not.toHaveBeenCalled();
  });

  it('updates the password, ends recovery, and replaces the page with sign in', async () => {
    authHarness.status = 'ready';
    authHarness.completePasswordRecovery.mockResolvedValue({ error: null });
    renderPage();

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'strong-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'strong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => {
      expect(authHarness.completePasswordRecovery).toHaveBeenCalledWith('strong-password');
      expect(screen.getByText('Sign-in destination')).toBeInTheDocument();
    });
  });
});
