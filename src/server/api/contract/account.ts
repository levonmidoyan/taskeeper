import { meShape } from './shapes';
import { defineEndpoint } from './types';

export const meEndpoint = defineEndpoint({
  operationId: 'getMe',
  method: 'GET',
  path: '/me',
  group: 'Account',
  summary: 'Who am I',
  description: 'The user the token belongs to. Handy for checking a token works.',
  workspace: false,
  status: 200,
  response: meShape,
  errors: [],
});
