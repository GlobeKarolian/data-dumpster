/**
 * Compatibility barrel.
 *
 * The transport policy and implementation now live together in `request.ts`.
 * Keep this re-export so older adapter imports do not split the policy again.
 */
export * from './request';
