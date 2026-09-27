import { describe, expect, it, vi } from 'vitest';
import { GlobalHttpExceptionFilter } from '../../backend/src/common/filters/http-exception.filter';
import { ApiClient } from '../src/lib/api-client';

describe('backend error → frontend client contract', () => {
  it('preserves the public message from the actual backend exception filter', async () => {
    let responseStatus = 0;
    let responseBody: unknown;
    const response = {
      status(code: number) { responseStatus = code; return this; },
      json(body: unknown) { responseBody = body; },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/orders', method: 'POST' }),
      }),
    } as unknown as Parameters<GlobalHttpExceptionFilter['catch']>[1];

    new GlobalHttpExceptionFilter().catch(new Error('private database details'), host);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), {
      status: responseStatus,
      headers: { 'Content-Type': 'application/json' },
    })));
    try {
      await expect(new ApiClient('/api').post('/orders', {}, { skipAuth: true })).rejects.toMatchObject({
        status: 500,
        message: 'An internal server error occurred. Please try again later.',
        data: responseBody,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
