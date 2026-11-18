import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ChatSession, ErrorEnvelope, Persona, SendMessage, fixtures } from '@pv/shared';
it('validates all neutral fixtures without publishing a core', () => {
  fixtures.forEach((p) => {
    expect(Persona.parse(p).mock).toBe(true);
    expect(p).not.toHaveProperty('coreText');
  });
});
it('rejects client supplied role and history', () => {
  expect(SendMessage.safeParse({ clientMessageId: 'bad', content: 'x', history: [] }).success).toBe(
    false,
  );
});
it('rejects falsely advertised real mode and malformed errors', () => {
  expect(ChatSession.safeParse({ id: 'x', mode: 'real' }).success).toBe(false);
  expect(ErrorEnvelope.safeParse({ error: { message: 'oops' } }).success).toBe(false);
});

it('keeps generated OpenAPI schemas identical to runtime contracts', () => {
  const doc = JSON.parse(readFileSync(new URL('../../docs/openapi.json', import.meta.url), 'utf8'));
  for (const [name, schema] of Object.entries({ ChatSession, ErrorEnvelope, Persona, SendMessage }))
    expect(doc.components.schemas[name]).toEqual(schema.toJSONSchema());
});
