import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Icon } from "./ui/Icon";
import { useToast } from "./ui/Toast";

const DISMISSED_KEY = "trackqr-review-prompt-dismissed";
const REQUESTED_KEY = "trackqr-review-requested";

type ReviewRequestResponse =
  | { success: true; code: "success"; message: string }
  | { success: false; code: string; message: string };

type ShopifyReviewsBridge = {
  reviews?: {
    request?: () => Promise<ReviewRequestResponse>;
  };
};

export function ReviewPrompt() {
  const shopify = useAppBridge() as unknown as ShopifyReviewsBridge;
  const toast = useToast();
  const [dismissed, setDismissed] = useState(true);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
  }, []);

  useEffect(() => {
    if (dismissed || requested) return;
    if (localStorage.getItem(REQUESTED_KEY) === "1") return;

    const requestReview = async () => {
      const request = shopify.reviews?.request;
      if (!request) return;

      localStorage.setItem(REQUESTED_KEY, "1");
      setRequested(true);

      try {
        const result = await request();
        if (!result.success && result.code !== "cancelled") {
          toast({
            type: "info",
            title: "Review prompt not shown",
            desc: "Shopify will show it later when the shop is eligible.",
          });
        }
      } catch {
        localStorage.removeItem(REQUESTED_KEY);
      }
    };

    void requestReview();
  }, [dismissed, requested, shopify.reviews, toast]);

  if (dismissed) return null;

  return (
    <div className="review-prompt" role="region" aria-label="Share feedback about TrackQr">
      <div className="review-prompt-icon">
        <Icon name="star" size={15} />
      </div>
      <div className="review-prompt-body">
        <div className="review-prompt-title">How was this QR setup?</div>
        <p>
          Shopify may ask for a quick review when your shop is eligible. Your feedback helps us improve
          TrackQr for merchants.
        </p>
        <div className="review-prompt-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              localStorage.setItem(DISMISSED_KEY, "1");
              setDismissed(true);
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
