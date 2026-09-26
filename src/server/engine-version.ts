/**
 * Which engine produced a frozen figure, for telling later what an investor
 * was actually sent from what the engine would say today.
 *
 * `||`, not `??`: a Vercel deploy made from the CLI rather than from git sets
 * VERCEL_GIT_COMMIT_SHA to an empty string, and production snapshots were
 * recorded with no version at all before this. The deployment's own URL is set
 * on every Vercel deploy and names exactly one build.
 */
export const ENGINE_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_URL ||
  process.env.ENGINE_VERSION ||
  'dev';
