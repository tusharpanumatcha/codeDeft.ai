import { createApiClient, endpoints, ApiError } from '../../../packages/protocol/src/index';

const token = () => document.querySelector<HTMLMetaElement>('meta[name="codedeft-token"]')?.content || undefined;
export const client = createApiClient({ client: `web-dashboard/${__APP_VERSION__}`, token });
export const api = endpoints(client);

/** A message that is always safe to show. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
export const isAbort = (error: unknown) => error instanceof ApiError && error.code === 'aborted';
