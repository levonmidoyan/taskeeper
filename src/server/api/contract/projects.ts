import { z } from 'zod';
import { listOf, projectDetailShape, projectShape, slugParam } from './shapes';
import { defineEndpoint } from './types';

export const listProjectsEndpoint = defineEndpoint({
  operationId: 'listProjects',
  method: 'GET',
  path: '/workspaces/{slug}/projects',
  group: 'Projects',
  summary: 'List projects',
  description: 'Active projects, by name. Archived projects are not listed.',
  workspace: true,
  params: z.object({ slug: slugParam }),
  status: 200,
  response: listOf(projectShape),
  errors: [],
});

export const getProjectEndpoint = defineEndpoint({
  operationId: 'getProject',
  method: 'GET',
  path: '/workspaces/{slug}/projects/{projectId}',
  group: 'Projects',
  summary: 'Get a project',
  description: 'One active project with its statuses (board columns) in board order. Status ids go in statusId.',
  workspace: true,
  params: z.object({ slug: slugParam, projectId: z.string().min(1) }),
  status: 200,
  response: projectDetailShape,
  errors: [],
});
