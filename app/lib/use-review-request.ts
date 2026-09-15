import { useCallback } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

type ReviewRequestResult = { success: boolean; code: string; message: string };
type ReviewsBridge = { reviews?: { request?: () => Promise<ReviewRequestResult> } };

const SESSION_KEY = "trackqr:review-requested";

/**
 * App Bridge Reviews API — asks Shopify to open its native in-admin review
 * modal (star rating + "Get support" for merchants who hit a problem).
 *
 * Rules of use:
 *  - call it right after a meaningful action has succeeded (QR activated,
 *    campaign published, subscription confirmed) — never on page load;
 *  - never wire it to a dedicated button: Shopify applies eligibility checks
 *    and rate limits (cooldown, annual cap, already reviewed, dev stores…), so
 *    a request may legitimately show nothing;
 *  - stay silent about the outcome — a declined request is only logged.
 */
export function useReviewRequest() {
  const shopify = useAppBridge() as unknown as ReviewsBridge;

  return useCallback(async (moment: string) => {
    const request = shopify.reviews?.request;
    if (!request) return;

    // One request per admin session is plenty; Shopify enforces the rest.
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
      if (storage.getItem(SESSION_KEY)) return;
    } catch {
      storage = null;
    }

    try {
      const result = await request();
      // "open-modal" means another modal was in the way — worth retrying later.
      if (result.code !== "open-modal") storage?.setItem(SESSION_KEY, moment);
      if (!result.success) {
        console.info(`[reviews] modal not shown after "${moment}": ${result.code} — ${result.message}`);
      }
    } catch (err) {
      console.info("[reviews] request failed", err);
    }
  }, [shopify]);
}
