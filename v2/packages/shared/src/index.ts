import { z } from 'zod';
export const Mode = z.literal('mock');
export const Persona = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  summary: z.string(),
  background: z.string(),
  mock: z.literal(true),
});
export type Persona = z.infer<typeof Persona>;
export const Message = z.object({
  id: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof Message>;
export const ChatSession = z.object({
  id: z.string().uuid(),
  personaSlug: z.string(),
  messages: z.array(Message),
  mode: Mode,
});
export type ChatSession = z.infer<typeof ChatSession>;
export const SendMessage = z
  .object({ clientMessageId: z.string().uuid(), content: z.string().trim().min(1).max(4000) })
  .strict();
export const CreateSession = z.object({ personaSlug: z.string().min(1).max(80) }).strict();
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
  }),
});
export const PersonaList = z.object({
  mode: Mode,
  items: z.array(Persona),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export const fixtures: Persona[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'test-a',
    name: '测试人格 A',
    category: '交互测试',
    summary: '用于验证浏览、收藏与连续对话。',
    background: '中性测试资料。站长尚未提供正式背景故事。',
    mock: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'test-b',
    name: '测试人格 B',
    category: '流程测试',
    summary: '用于验证人格切换与独立会话。',
    background: '中性测试资料。没有正式人格内核。',
    mock: true,
  },
];
