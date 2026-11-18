/** Server-only DeepSeek transport. Never import this module into the web application. */
import { z } from 'zod';
export type DeepSeekMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelMessage = DeepSeekMessage;
export type DeepSeekResult = { content: string; promptTokens: number; completionTokens: number };
export class DeepSeekError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'UPSTREAM_FAILED' | 'INVALID_RESPONSE') {
    super(code);
  }
}
const tokens = z.number().int().nonnegative().safe();
const resultSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().optional(),
        message: z.object({
          role: z.string().optional(),
          content: z.string().trim().min(1).max(32000),
        }),
      }),
    )
    .length(1),
  usage: z.object({ prompt_tokens: tokens, completion_tokens: tokens }),
});
export async function deepSeekComplete(
  messages: DeepSeekMessage[],
  options: {
    apiKey?: string;
    model?: 'deepseek-chat' | 'deepseek-reasoner';
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    strict?: boolean;
  } = {},
): Promise<DeepSeekResult> {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey || /\s/.test(apiKey)) throw new DeepSeekError('NOT_CONFIGURED');
  if (!messages.length || messages.length > 1002 || messages.some((m) => !m.content.trim()))
    throw new DeepSeekError('INVALID_RESPONSE');
  try {
    const response = await (options.fetchImpl ?? fetch)(
      'https://api.deepseek.com/chat/completions',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: options.model ?? 'deepseek-chat',
          messages,
          stream: false,
          max_tokens: 1024,
        }),
      },
    );
    if (!response.ok) throw new DeepSeekError('UPSTREAM_FAILED');
    if (options.strict && !/^application\/json\b/i.test(response.headers.get('content-type') ?? ''))
      throw new DeepSeekError('INVALID_RESPONSE');
    const reader = response.body?.getReader();
    if (!reader) throw new DeepSeekError('INVALID_RESPONSE');
    let size = 0,
      raw = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 131072) {
          await reader.cancel();
          throw new DeepSeekError('INVALID_RESPONSE');
        }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = resultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new DeepSeekError('INVALID_RESPONSE');
    const choice = parsed.data.choices[0]!;
    if (options.strict && (choice.finish_reason !== 'stop' || choice.message.role !== 'assistant'))
      throw new DeepSeekError('INVALID_RESPONSE');
    return {
      content: choice.message.content,
      promptTokens: parsed.data.usage.prompt_tokens,
      completionTokens: parsed.data.usage.completion_tokens,
    };
  } catch (error) {
    if (error instanceof DeepSeekError) throw error;
    throw new DeepSeekError('UPSTREAM_FAILED');
  }
}
// Budgeted user chat uses strict complete responses; no endpoint override or automatic retry.
export class DeepSeekProvider {
  readonly maxOutputTokens = 1024;
  readonly priceVersion = 'deepseek-chat-production-v1';
  constructor(
    private key: string,
    private transport: typeof fetch = fetch,
  ) {
    if (!key || /\s/.test(key)) throw new DeepSeekError('NOT_CONFIGURED');
  }
  async complete(messages: ModelMessage[]) {
    const result = await deepSeekComplete(messages, {
      apiKey: this.key,
      fetchImpl: this.transport,
      timeoutMs: 60000,
      strict: true,
    });
    return {
      content: result.content,
      inputTokens: result.promptTokens,
      outputTokens: result.completionTokens,
    };
  }
}
