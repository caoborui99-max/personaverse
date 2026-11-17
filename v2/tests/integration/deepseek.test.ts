import { describe, expect, it, vi } from 'vitest';
import { deepSeekComplete, DeepSeekError } from '../../apps/api/src/ai/deepseek.ts';

describe('DeepSeek server transport', () => {
  it('rejects absent credentials without making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      deepSeekComplete([{ role: 'user', content: '你好' }], {
        apiKey: '',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('uses server authorization and parses model usage', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-key' });
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('deepseek-chat');
      expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '你好！' } }],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        }),
        { status: 200 },
      );
    });
    const result = await deepSeekComplete([{ role: 'user', content: '你好' }], {
      apiKey: 'test-only-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toEqual({ content: '你好！', promptTokens: 8, completionTokens: 4 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('fails closed on upstream errors and malformed responses', async () => {
    const messages = [{ role: 'user' as const, content: 'test' }];
    await expect(
      deepSeekComplete(messages, {
        apiKey: 'test-only-key',
        fetchImpl: vi.fn(async () => new Response('failure', { status: 429 })),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    await expect(
      deepSeekComplete(messages, {
        apiKey: 'test-only-key',
        fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
