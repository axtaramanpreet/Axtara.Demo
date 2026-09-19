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

/**
 * Email delivery settings.
 *
 * Returns null when no provider is configured, so the app runs without one and
 * the Notices tab can say plainly that nothing will be delivered — which is
 * honest, and better than a send that silently goes nowhere.
 *
 * `overrideTo` is a safety catch, not a convenience. While it is set, every
 * notice is redirected to that one address whatever the register says, so a
 * test deployment pointed at real investor data cannot email a real investor.
 * Clearing it is the deliberate act of going live.
 */
export function emailEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('emailEnv() was called in the browser. The API key must stay on the server.');
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;

  return {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    apiKey,
    from,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    overrideTo: process.env.EMAIL_OVERRIDE_TO || undefined,
  };
}

/**
 * What the browser may know about email: whether it is configured at all, and
 * whether sends are being redirected. Never the key, never the provider's
 * credentials.
 */
/**
 * Whether Ask Axtara has a model behind it — the only thing about the model the
 * browser is allowed to know.
 *
 * `foundryEnv()` throws if it is ever called in the browser, because the key it
 * reads would otherwise be inlined into the bundle. This is the safe half.
 */
export function askStatusForClient() {
  return { connected: foundryEnv() !== null };
}

export function emailStatusForClient() {
  const config = emailEnv();
  return {
    configured: config !== null,
    overrideTo: config?.overrideTo ?? null,
  };
}

/**
 * Defaults a new, blank call starts with.
 *
 * The signatory is the same person on every call a firm issues, and typing it
 * again each time is how it ends up wrong. Configuration rather than a literal
 * in the engine, so changing who signs is a setting and not a deployment.
 *
 * An uploaded workbook always wins: these only fill a field nobody has set.
 */
export function noticeDefaults() {
  return {
    gpName: process.env.NOTICE_GP_NAME || '',
    signatoryName: process.env.NOTICE_SIGNATORY_NAME || '',
    signatoryTitle: process.env.NOTICE_SIGNATORY_TITLE || '',
  };
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
