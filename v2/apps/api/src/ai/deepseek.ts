/** Server-only DeepSeek transport. Never import this module into the web application. */
export type DeepSeekMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type DeepSeekResult = { content: string; promptTokens: number; completionTokens: number };
export class DeepSeekError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'UPSTREAM_FAILED' | 'INVALID_RESPONSE') {
    super(code);
  }
}
export async function deepSeekComplete(
  messages: DeepSeekMessage[],
  options: {
    apiKey?: string;
    model?: 'deepseek-chat' | 'deepseek-reasoner';
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<DeepSeekResult> {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError('NOT_CONFIGURED');
  if (!messages.length || messages.length > 40 || messages.some(m => !m.content.trim() || m.content.length > 12000))
    throw new DeepSeekError('INVALID_RESPONSE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model ?? 'deepseek-chat',
        messages,
        stream: false,
        max_tokens: 1024,
      }),
    });
    if (!response.ok) throw new DeepSeekError('UPSTREAM_FAILED');
    const raw = await response.text();
    if (raw.length > 200000) throw new DeepSeekError('INVALID_RESPONSE');
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new DeepSeekError('INVALID_RESPONSE'); }
    if (!data || typeof data !== 'object') throw new DeepSeekError('INVALID_RESPONSE');
    const result = data as {
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const answer = result.choices?.[0]?.message?.content;
    const promptTokens = result.usage?.prompt_tokens;
    const completionTokens = result.usage?.completion_tokens;
    if (typeof answer !== 'string' || !answer.trim() ||
        typeof promptTokens !== 'number' || !Number.isSafeInteger(promptTokens) || promptTokens < 0 ||
        typeof completionTokens !== 'number' || !Number.isSafeInteger(completionTokens) || completionTokens < 0)
      throw new DeepSeekError('INVALID_RESPONSE');
    return { content: answer, promptTokens, completionTokens };
  } catch (error) {
    if (error instanceof DeepSeekError) throw error;
    throw new DeepSeekError('UPSTREAM_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
