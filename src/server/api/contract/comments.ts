import { z } from 'zod';
import { commentBodySchema } from '@/server/comments/service';
import { commentShape, listOf } from './shapes';
import { taskParams } from './tasks';
import { defineEndpoint } from './types';

export const listCommentsEndpoint = defineEndpoint({
  operationId: 'listComments',
  method: 'GET',
  path: '/workspaces/{slug}/tasks/{taskId}/comments',
  group: 'Comments',
  summary: 'List comments',
  description: 'A task’s comments, oldest first.',
  workspace: true,
  params: taskParams,
  status: 200,
  response: listOf(commentShape),
  errors: [],
});

export const createCommentEndpoint = defineEndpoint({
  operationId: 'createComment',
  method: 'POST',
  path: '/workspaces/{slug}/tasks/{taskId}/comments',
  group: 'Comments',
  summary: 'Comment on a task',
  description: 'Markdown, up to 10,000 characters. You are the author.',
  workspace: true,
  params: taskParams,
  body: z.object({ body: commentBodySchema.describe('Markdown.') }),
  status: 201,
  response: commentShape,
  errors: [],
  example: { body: { body: 'Deployed in build 412.' } },
});
