import { meEndpoint } from './account';
import { getProjectEndpoint, listProjectsEndpoint } from './projects';
import {
  createTaskEndpoint, deleteTaskEndpoint, getTaskEndpoint, listTasksEndpoint, updateTaskEndpoint,
} from './tasks';
import type { Endpoint } from './types';
import { listLabelsEndpoint, listMembersEndpoint, listWorkspacesEndpoint } from './workspaces';

/** Every v1 endpoint, in the order the docs list them. tests/unit/openapi.test.ts checks it against src/app/api/v1. */
export const endpoints: readonly Endpoint[] = [
  meEndpoint,
  listWorkspacesEndpoint,
  listLabelsEndpoint,
  listMembersEndpoint,
  listProjectsEndpoint,
  getProjectEndpoint,
  listTasksEndpoint,
  createTaskEndpoint,
  getTaskEndpoint,
  updateTaskEndpoint,
  deleteTaskEndpoint,
];
