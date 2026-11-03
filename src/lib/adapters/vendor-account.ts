/**
 * Vendor ACCOUNT failures, as opposed to failures about one profile.
 *
 * When a vendor rejects our account (Bright Data "Customer is not active",
 * Jul 30 to Sep 28 2026; X API "402 Payment Required: credits depleted",
 * Sep 9 to Oct 20 2026), every profile on that vendor fails the same way and
 * nothing about any one profile is wrong. Treating those as per-profile
 * permanent failures stranded 400+ profiles after both accounts recovered:
 * they sat in operator review for weeks and nobody was asked.
 *
 * These rejections are safe to retry: the vendor refused before doing any
 * work, so no record was purchased and no paid receipt exists to lose.
 * Collection therefore keeps retrying them on a slow cadence and never
 * escalates them, so the first run after a top-up or reactivation heals every
 * profile on its own.
 *
 * Patterns name the vendor-side condition only. "Account suspended" is left
 * out on purpose: on X it usually describes the PROFILE, which is a real
 * per-profile failure.
 */
const PATTERNS: RegExp[] = [
  /customer is not active/i,
  /\bcredits? depleted\b/i,
  /\b402\b[^|]*payment required/i,
  /insufficient (?:account )?(?:balance|credits?|funds)/i,
  /\bzone (?:is )?(?:disabled|inactive)\b/i,
];

export function isVendorAccountError(message: string | null | undefined): boolean {
  if (!message) return false;
  return PATTERNS.some((p) => p.test(message));
}

/** Retry cadence while a vendor account is down: often enough to heal within hours, quiet enough not to hammer. */
export const VENDOR_ACCOUNT_RETRY_MINUTES = 6 * 60;
