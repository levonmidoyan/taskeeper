import { z } from 'zod';
import { labelShape, listOf, memberShape, slugParam, workspaceShape } from './shapes';
import { defineEndpoint } from './types';

const wsParams = z.object({ slug: slugParam });

export const listWorkspacesEndpoint = defineEndpoint({
  operationId: 'listWorkspaces',
  method: 'GET',
  path: '/workspaces',
  group: 'Workspaces',
  summary: 'List workspaces',
  description: 'Every workspace you are a member of, with your role there. The token works in all of them.',
  workspace: false,
  status: 200,
  response: listOf(workspaceShape),
  errors: [],
});

export const listLabelsEndpoint = defineEndpoint({
  operationId: 'listLabels',
  method: 'GET',
  path: '/workspaces/{slug}/labels',
  group: 'Workspaces',
  summary: 'List labels',
  description: 'The workspace’s labels, by name. Use their ids in labelIds and the labels filter.',
  workspace: true,
  params: wsParams,
  status: 200,
  response: listOf(labelShape),
  errors: [],
});

export const listMembersEndpoint = defineEndpoint({
  operationId: 'listMembers',
  method: 'GET',
  path: '/workspaces/{slug}/members',
  group: 'Workspaces',
  summary: 'List members',
  description: 'Everyone in the workspace, by name. Use their ids as assigneeId and in the assignee filter.',
  workspace: true,
  params: wsParams,
  status: 200,
  response: listOf(memberShape),
  errors: [],
});
