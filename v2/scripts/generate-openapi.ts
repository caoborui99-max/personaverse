import { writeFileSync } from 'node:fs';
import {
  ChatSession,
  CreateSession,
  SendMessage,
  ErrorEnvelope,
  Persona,
  PersonaList,
} from '@pv/shared';
const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const response = (name: string) => ({
  description: 'Mock response',
  content: { 'application/json': { schema: ref(name) } },
});
const body = (name: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
});
const error = response('ErrorEnvelope');
const owned = [{ visitorCookie: [] }];
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const doc = {
  openapi: '3.1.0',
  info: {
    title: 'PersonaVerse V2 mock API',
    version: '0.1.0',
    description:
      'Local development only. No real AI, database or administrator authentication. Future contracts are documented separately.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/health': {
      get: {
        responses: {
          '200': { description: 'Service only; database and AI explicitly not connected' },
        },
      },
    },
    '/personas': {
      get: {
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 120 } },
          { name: 'category', in: 'query', schema: { type: 'string', maxLength: 80 } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
        ],
        responses: { '200': response('PersonaList'), '400': error },
      },
    },
    '/personas/{slug}': {
      get: {
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Mock profile',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { mode: { const: 'mock' }, persona: ref('Persona') },
                  required: ['mode', 'persona'],
                },
              },
            },
          },
          '404': error,
        },
      },
    },
    '/categories': { get: { responses: { '200': { description: 'Neutral mock categories' } } } },
    '/visitor/session': {
      post: {
        description: 'Exact configured Origin required for every write. Sets HttpOnly mock cookie.',
        responses: {
          '200': { description: 'Mock anonymous session ready' },
          '403': error,
          '503': error,
        },
      },
    },
    '/chat/sessions': {
      post: {
        security: owned,
        requestBody: body('CreateSession'),
        responses: {
          '201': response('ChatSession'),
          '400': error,
          '401': error,
          '403': error,
          '404': error,
          '429': error,
        },
      },
      delete: {
        security: owned,
        responses: {
          '200': { description: 'Clears all mock histories owned by current cookie' },
          '401': error,
          '403': error,
        },
      },
    },
    '/chat/sessions/{id}/messages': {
      parameters: [id],
      get: {
        security: owned,
        responses: { '200': response('ChatSession'), '401': error, '404': error },
      },
      post: {
        security: owned,
        requestBody: body('SendMessage'),
        description:
          'Same clientMessageId + content is idempotent. /fail-once fails once with 503 before saving.',
        responses: {
          '200': response('ChatSession'),
          '400': error,
          '401': error,
          '403': error,
          '404': error,
          '409': error,
          '429': error,
          '503': error,
        },
      },
    },
    '/admin/auth/login': {
      post: {
        responses: { '503': error, '403': error },
        description: 'Always AUTH_NOT_IMPLEMENTED for valid Origin; never sets an admin cookie.',
      },
    },
    '/admin/auth/session': { get: { responses: { '401': error } } },
    '/admin/auth/logout': { post: { responses: { '401': error, '403': error } } },
    '/admin/personas': {
      get: { responses: { '401': error } },
      post: { responses: { '401': error, '403': error } },
    },
  },
  components: {
    securitySchemes: { visitorCookie: { type: 'apiKey', in: 'cookie', name: 'pv_v2_mock' } },
    schemas: Object.fromEntries(
      Object.entries({
        ChatSession,
        CreateSession,
        SendMessage,
        ErrorEnvelope,
        Persona,
        PersonaList,
      }).map(([name, schema]) => [name, schema.toJSONSchema()]),
    ),
  },
};
writeFileSync('docs/openapi.json', JSON.stringify(doc, null, 2) + '\n');
