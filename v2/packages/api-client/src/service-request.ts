import { signBridge } from './private-bridge.ts';
// Only used by server-side SSR, before the request crosses a private Service Binding.
export async function privateApiRequest(
  url: string,
  options: RequestInit,
  origin: string,
  secret: string,
) {
  const publicUrl = new URL(origin);
  const source = new URL(url);
  if (
    publicUrl.protocol !== 'https:' ||
    publicUrl.origin !== origin ||
    publicUrl.port ||
    publicUrl.username ||
    publicUrl.password
  )
    throw new Error('EXACT_HTTPS_ORIGIN_REQUIRED');
  if (
    !source.pathname.startsWith('/api/v1/') ||
    source.pathname.includes('\\') ||
    source.pathname.includes('//')
  )
    throw new Error('API_PATH_REQUIRED');
  // Assign path/search onto a fresh origin: never inherit the development authority or port.
  publicUrl.pathname = source.pathname;
  publicUrl.search = source.search;
  return signBridge(new Request(publicUrl, options), secret, 'ssr');
}
