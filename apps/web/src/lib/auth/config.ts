// Runtime half of the production guardrails. The build-time half is in
// next.config.mjs; both call the same module so they cannot drift apart
// again (issue #57). Re-exported because this module is the documented home
// of auth config, and because importing it is what triggers validation.
export {
  validateProductionConfig,
  isProductionNetwork,
} from '@/lib/config/production-guardrails.mjs';

import { validateProductionConfig } from '@/lib/config/production-guardrails.mjs';

export const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? 'Pocketlet';
export const RP_ID = process.env.WEBAUTHN_RP_ID?.trim() || 'localhost';
export const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3000';

export const SESSION_COOKIE_NAME = 'pocketlet_session';
export const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'dev-secret-change-in-production';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

validateProductionConfig();
