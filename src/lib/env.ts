/**
 * Environment access, validated once and in one place.
 *
 * The distinction that matters here is which side of the wire a value may
 * reach. Anything named `NEXT_PUBLIC_*` is compiled into the browser bundle and
 * is visible to everyone who loads the page. Everything else must only ever be
 * read from server code — a route handler or a server component.
 *
 * The service-role key bypasses every row-level security policy, and the Azure
 * key bills the deployment, so both are read through `serverEnv()`, which
 * throws if it is ever reached from a browser.
 */

/** Values safe to ship to the browser. */
export function publicEnv() {
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: required(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/**
 * Server-only secrets.
 *
 * `window` being defined means this ran in a browser, which for these values is
 * a programming error rather than a configuration one — fail loudly instead of
 * returning something that might get rendered.
 */
export function serverEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() was called in the browser. These values must never be sent there.');
  }
  return {
    supabaseServiceRoleKey: required(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}

/**
 * Azure AI Foundry settings for Ask Axtara.
 *
 * Returns null rather than throwing when unset, so the rest of the app runs
 * without it and the panel can say it is not connected — which is honest, and
 * better than a crash on a page that has nothing to do with the assistant.
 */
export function foundryEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('foundryEnv() was called in the browser. The API key must stay on the server.');
  }
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  const deployment = process.env.AZURE_FOUNDRY_DEPLOYMENT;
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
  if (!endpoint || !deployment || !apiKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    deployment,
    apiKey,
    apiVersion: process.env.AZURE_FOUNDRY_API_VERSION || '2024-10-21',
  };
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
