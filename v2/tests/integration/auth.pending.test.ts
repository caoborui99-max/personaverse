import { describe, it } from 'vitest';
describe('NOT IMPLEMENTED: production authentication and AI', () => {
  it.todo('Argon2id account login followed by actual persisted session verification');
  it.todo('session expiry, logout and credential-change revocation in PostgreSQL');
  it.todo('CSRF token and trusted HTTPS proxy production verification');
  it.todo('authenticated admin chats bypass visitor quota and can use unpublished versions');
  it.todo('DeepSeek streaming, token accounting, cost reservation and circuit breaker');
  it.todo('PostgreSQL migration execution, immutable-version constraints and restore drill');
});
