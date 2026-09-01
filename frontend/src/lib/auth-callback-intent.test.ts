import { describe, expect, it } from 'vitest';

import { hasInitialImplicitRecoveryIntent } from './auth-callback-intent';

describe('hasInitialImplicitRecoveryIntent', () => {
  it('recognizes a complete implicit password recovery callback', () => {
    expect(
      hasInitialImplicitRecoveryIntent({
        search: '',
        hash: '#type=recovery&access_token=placeholder&refresh_token=placeholder&expires_in=3600&token_type=bearer',
      })
    ).toBe(true);
  });

  it.each([
    ['', ''],
    ['', '#type=recovery'],
    ['', '#type=recovery&access_token_hint=placeholder&refresh_token_hint=placeholder'],
    ['', '#type=recovery&access_token=&refresh_token=&expires_in=3600&token_type=bearer'],
    ['', '#type=signup&access_token=placeholder&refresh_token=placeholder&expires_in=3600&token_type=bearer'],
  ])('rejects ordinary, bare, empty, or similar callback parameters', (search, hash) => {
    expect(hasInitialImplicitRecoveryIntent({ search, hash })).toBe(false);
  });
});
