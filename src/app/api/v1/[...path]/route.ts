import { apiError } from '@/server/api/errors';

/** Any /api/v1 path no route file serves: the API's JSON 404, not the app's HTML page. */
const notFound = async () => apiError('not_found', 'No such API endpoint. See /docs/api.');

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
