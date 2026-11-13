import { writeFileSync } from 'node:fs';
import {
  ChatSession,
  CreateSession,
  SendMessage,
  ErrorEnvelope,
  Persona,
  PersonaList,
  SaveDraft,
  RevisionInput,
  AdminPersona,
  CoreVersion,
  DraftFields,
} from '@pv/shared';
const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const response = (name: string) => ({
  description: 'Validated response',
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
    title: 'PersonaVerse V2 database API',
    version: '0.3.0',
    description:
      'PostgreSQL catalogue and server-side admin sessions. AI replies remain mock. PV_MODE=mock-regression is an isolated phase-2 regression mode.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/health': {
      get: {
        responses: {
          '200': { description: 'Database connectivity checked; real AI not connected' },
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
            description: 'Published profile whitelist',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { mode: { enum: ['database', 'mock'] }, persona: ref('Persona') },
                  required: ['mode', 'persona'],
                },
              },
            },
          },
          '404': error,
        },
      },
    },
    '/categories': { get: { responses: { '200': { description: 'Published categories' } } } },
    '/visitor/session': {
      post: {
        description:
          'Exact configured Origin required for every write. Sets an independent HttpOnly visitor cookie.',
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
          '200': response('ChatSession'),
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
    '/admin/auth/csrf': {
      get: {
        responses: {
          '200': { description: 'Pre-login CSRF token; sets HttpOnly pre-login cookie' },
        },
      },
    },
    '/admin/auth/login': {
      post: {
        description:
          'Pre-login cookie + x-csrf-token + trusted Origin required. Does not replace actual session verification.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', maxLength: 256 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Opaque session Cookie created; verify with GET session' },
          '401': error,
          '403': error,
          '429': error,
          '503': error,
        },
      },
    },
    '/admin/auth/session': {
      get: {
        responses: {
          '200': { description: 'Verified admin id, email, role and session-bound csrfToken' },
          '401': error,
          '503': error,
        },
      },
    },
    '/admin/auth/logout': {
      post: {
        responses: {
          '200': { description: 'Session revoked' },
          '401': error,
          '403': error,
          '503': error,
        },
      },
    },
    '/admin/auth/password': {
      post: {
        responses: {
          '200': { description: 'Password updated and all sessions revoked' },
          '400': error,
          '401': error,
          '403': error,
          '503': error,
        },
      },
    },
    '/admin/categories': {
      get: { responses: { '200': { description: 'Administrator category list' }, '401': error } },
      post: {
        responses: {
          '200': { description: 'Category created' },
          '400': error,
          '401': error,
          '403': error,
          '409': error,
        },
      },
    },
    '/admin/personas': {
      get: {
        responses: {
          '200': {
            description: 'Paginated administrator catalogue; q, status and category filters',
          },
          '401': error,
          '503': error,
        },
      },
      post: {
        responses: { '201': response('AdminPersona'), '401': error, '403': error, '503': error },
      },
    },
    '/admin/personas/{id}': {
      parameters: [id],
      get: { responses: { '200': response('AdminPersona'), '401': error, '404': error } },
      put: {
        requestBody: body('SaveDraft'),
        responses: {
          '200': response('AdminPersona'),
          '400': error,
          '401': error,
          '403': error,
          '409': error,
          '503': error,
        },
      },
    },
    '/admin/personas/{id}/publish': {
      parameters: [id],
      post: {
        requestBody: body('RevisionInput'),
        responses: {
          '200': response('AdminPersona'),
          '400': error,
          '401': error,
          '403': error,
          '409': error,
        },
      },
    },
    '/admin/personas/{id}/unpublish': {
      parameters: [id],
      post: {
        requestBody: body('RevisionInput'),
        responses: { '200': response('AdminPersona'), '401': error, '403': error, '409': error },
      },
    },
    '/admin/personas/{id}/archive': {
      parameters: [id],
      post: {
        requestBody: body('RevisionInput'),
        responses: { '200': response('AdminPersona'), '401': error, '403': error, '409': error },
      },
    },
    '/admin/personas/{id}/versions': {
      parameters: [id],
      get: {
        responses: {
          '200': { description: 'Immutable versions, newest first' },
          '401': error,
          '404': error,
        },
      },
    },
    '/admin/personas/{id}/compare': {
      parameters: [id],
      get: {
        description:
          'from and to version UUIDs must belong to this persona; returns both originals and changed fields',
        responses: { '200': { description: 'Version comparison' }, '401': error, '404': error },
      },
    },
    '/admin/personas/{id}/restore': {
      parameters: [id],
      post: {
        description: 'versionId + expectedRevision; appends new version and snapshot atomically',
        responses: {
          '200': response('AdminPersona'),
          '401': error,
          '403': error,
          '404': error,
          '409': error,
        },
      },
    },
    '/admin/test/sessions': {
      post: {
        description: 'personaId + versionId; verified owner only, including unpublished versions',
        responses: {
          '200': { description: 'Fixed-version mock test session' },
          '401': error,
          '403': error,
          '404': error,
        },
      },
    },
    '/admin/test/sessions/{id}/messages': {
      parameters: [id],
      get: {
        responses: {
          '200': { description: 'Owned admin test history' },
          '401': error,
          '404': error,
        },
      },
      post: {
        requestBody: body('SendMessage'),
        responses: {
          '200': { description: 'Mock response; no visitor quota or paid model call' },
          '401': error,
          '403': error,
          '409': error,
          '503': error,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      visitorCookie: { type: 'apiKey', in: 'cookie', name: 'pv_v2_visitor_local' },
      adminCookie: { type: 'apiKey', in: 'cookie', name: 'pv_v2_admin_local' },
    },
    schemas: Object.fromEntries(
      Object.entries({
        ChatSession,
        CreateSession,
        SendMessage,
        ErrorEnvelope,
        Persona,
        PersonaList,
        SaveDraft,
        RevisionInput,
        AdminPersona,
        CoreVersion,
        DraftFields,
      }).map(([name, schema]) => [name, schema.toJSONSchema()]),
    ),
  },
};
writeFileSync('docs/openapi.json', JSON.stringify(doc, null, 2) + '\n');
