import { z } from 'zod';
export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
const usage = z.number().int().nonnegative().safe();
const completion = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.literal('stop'),
        message: z.object({ role: z.literal('assistant'), content: z.string().min(1).max(32000) }),
      }),
    )
    .length(1),
  usage: z.object({ prompt_tokens: usage, completion_tokens: usage }),
});
// Server-only. No configurable endpoint, redirects, retries, tools or streaming side effects.
export class DeepSeekProvider {
  readonly maxOutputTokens = 1024;
  readonly priceVersion = 'deepseek-chat-production-v1';
  constructor(
    private key: string,
    private transport: typeof fetch = fetch,
  ) {
    if (!key || /\s/.test(key)) throw new Error('DEEPSEEK_SECRET_REQUIRED');
  }
  async complete(messages: ModelMessage[]) {
    const response = await this.transport('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: this.maxOutputTokens,
        stream: false,
      }),
    });
    if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') ?? ''))
      throw new Error('DEEPSEEK_OUTCOME_UNKNOWN');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('DEEPSEEK_OUTCOME_UNKNOWN');
    let size = 0,
      text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 131072) {
          await reader.cancel();
          throw new Error('DEEPSEEK_RESPONSE_LIMIT');
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const result = completion.parse(JSON.parse(text));
    return {
      content: result.choices[0]!.message.content,
      inputTokens: result.usage.prompt_tokens,
      outputTokens: result.usage.completion_tokens,
    };
  }
}
