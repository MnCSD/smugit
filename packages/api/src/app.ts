import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';

import {
  ConflictType,
  analyzeConflictComplexity,
  extractScopeFromBranch,
  generateConflictExplanation,
  inferCommitType,
  isAutoResolvable,
} from '@smugit/shared';

import { API_VERSION } from './version';

const conflictAnalysisSchema = z.object({
  file: z.string(),
  type: z.nativeEnum(ConflictType),
  currentContent: z.string(),
  incomingContent: z.string(),
});

const commitSuggestionSchema = z.object({
  changedFiles: z.array(z.string()).nonempty(),
  branch: z.string().optional(),
  description: z.string().optional(),
});

const conflictAnalysisBodySchema = {
  type: 'object',
  required: ['file', 'type', 'currentContent', 'incomingContent'],
  properties: {
    file: { type: 'string' },
    type: { type: 'string', enum: Object.values(ConflictType) },
    currentContent: { type: 'string' },
    incomingContent: { type: 'string' },
  },
} as const;

const commitSuggestionBodySchema = {
  type: 'object',
  required: ['changedFiles'],
  properties: {
    changedFiles: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
    branch: { type: 'string' },
    description: { type: 'string' },
  },
} as const;

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(swagger, {
    swagger: {
      info: {
        title: 'Smugit API',
        description: 'Backend services for conflict analysis and git insights',
        version: API_VERSION,
      },
      tags: [
        { name: 'health', description: 'Service health checks' },
        { name: 'conflicts', description: 'Conflict analysis endpoints' },
        { name: 'commits', description: 'Commit suggestion helpers' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
    transformStaticCSP(header) {
      return header;
    },
  });

  app.get('/health', {
    schema: {
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async () => ({
    status: 'ok',
    version: API_VERSION,
    uptime: process.uptime(),
  }));

  app.post('/conflicts/analyze', {
    schema: {
      tags: ['conflicts'],
      body: conflictAnalysisBodySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            type: { type: 'string' },
            complexity: { type: 'string' },
            autoResolvable: { type: 'boolean' },
            explanation: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const payload = conflictAnalysisSchema.parse(request.body);

    const complexity = analyzeConflictComplexity(
      payload.currentContent,
      payload.incomingContent,
    );

    const autoResolvable = isAutoResolvable(payload.type, complexity);
    const explanation = generateConflictExplanation(
      payload.type,
      payload.file,
      payload.currentContent,
      payload.incomingContent,
    );

    return {
      file: payload.file,
      type: payload.type,
      complexity,
      autoResolvable,
      explanation,
    };
  });

  app.post('/commits/suggest', {
    schema: {
      tags: ['commits'],
      body: commitSuggestionBodySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            suggestion: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                scope: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                description: { type: 'string' },
              },
            },
            confidence: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const payload = commitSuggestionSchema.parse(request.body);

    const type = inferCommitType(payload.changedFiles);
    const scope = payload.branch ? extractScopeFromBranch(payload.branch) : undefined;
    const description = payload.description ?? 'update project files';

    return {
      suggestion: {
        type,
        scope: scope ?? null,
        description,
      },
      confidence: scope ? 0.8 : 0.6,
    };
  });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';

  const app = await createServer();

  try {
    await app.listen({ port, host });
    app.log.info(`Smugit API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    await app.close();
    throw err;
  }

  return app;
}
