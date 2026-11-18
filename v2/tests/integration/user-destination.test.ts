import { it, expect } from 'vitest';
import { safeUserDestination } from '../../apps/web/src/lib/user-destination.ts';
const origin = 'https://example.invalid';
it('normalizes encoded administrator paths and rejects ambiguous or external destinations', () => {
  for (const value of [
    null,
    '',
    'https://outside.invalid/',
    '//outside.invalid/',
    '/admin',
    '/%61dmin',
    '/admin%2flogin',
    '/%2561dmin',
    '/%2f%2foutside.invalid',
    '/\\outside.invalid',
    '/%5cadmin',
    '/%0aadmin',
    '/%E0%A4%A',
    '/private/../admin',
    '/auth/rengine/callback?type=code',
    '/login?next=/admin',
  ])
    expect(safeUserDestination(value, origin)).toBe('/account');
});
it('keeps valid same-origin user routes and queries', () => {
  for (const value of [
    '/',
    '/account',
    '/history',
    '/history/a?before=3',
    '/favorites',
    '/chat/test-only',
    '/explore?q=%E6%B5%8B%E8%AF%95',
  ])
    expect(safeUserDestination(value, origin)).toBe(value);
  expect(safeUserDestination('/%68istory', origin)).toBe('/history');
});
