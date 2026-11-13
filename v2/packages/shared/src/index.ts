import { z } from 'zod';
export const Mode = z.literal('mock');
export const Persona = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  summary: z.string(),
  background: z.string(),
  mock: z.boolean(),
  avatarUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
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
  mode: z.enum(['mock', 'database']),
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
export const DraftFields = z
  .object({
    name: z.string().max(80),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    summary: z.string().max(2000),
    background: z.string().max(50000),
    avatarUrl: z.union([
      z.literal(''),
      z
        .string()
        .url()
        .refine((value) => new URL(value).protocol === 'https:', '头像引用必须为 HTTPS'),
    ]),
    tags: z.array(z.string().max(80)).max(30),
    categoryIds: z.array(z.string().uuid()).max(20),
    coreText: z.string().max(2_000_000),
    openingMessage: z.string().max(20000),
  })
  .strict();
export type DraftFields = z.infer<typeof DraftFields>;
export const SaveDraft = DraftFields.extend({ expectedRevision: z.number().int().min(0) }).strict();
export const RevisionInput = z.object({ expectedRevision: z.number().int().min(0) }).strict();
export const PublishInput = RevisionInput.extend({ expectedVersionId: z.string().uuid() }).strict();
export const CoreVersion = z.object({
  id: z.string().uuid(),
  personaId: z.string().uuid(),
  versionNumber: z.number(),
  coreText: z.string(),
  openingMessage: z.string(),
  profileSnapshot: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  createdBy: z.string(),
  restoredFromId: z.string().nullable(),
  author: z.object({ id: z.string(), email: z.string() }).optional(),
});
export type CoreVersion = z.infer<typeof CoreVersion>;
export const AdminPersona = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  summary: z.string().default(''),
  background: z.string().default(''),
  avatarUrl: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published', 'archived']),
  revision: z.number(),
  isTest: z.boolean(),
  draftVersionId: z.string().nullable(),
  publishedVersionId: z.string().nullable(),
  draftVersion: CoreVersion.nullable().default(null),
  categories: z
    .array(
      z.object({
        categoryId: z.string(),
        category: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
      }),
    )
    .default([]),
});
export type AdminPersona = z.infer<typeof AdminPersona>;
