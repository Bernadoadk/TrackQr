/**
 * Shopify Admin GraphQL — create a basic percentage-off discount code.
 * Used by the Create QR page when type=promo + "Auto-create discount" is on.
 *
 * Failures are non-fatal: the QR still gets created, but the discount code
 * may not exist server-side. The caller decides how to surface this.
 */

type AdminGraphQL = {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface CreateDiscountInput {
  code:      string;
  /** Percentage off (0–1). 0.10 = 10%. */
  percentage: number;
  /** Optional title for the discount in admin. */
  title?:    string;
  /** Optional usage limit (null = unlimited). */
  usageLimit?: number | null;
  /** Optional expiration date. */
  endsAt?:   Date | null;
}

const MUTATION = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

export async function createDiscountCode(
  admin: AdminGraphQL,
  input: CreateDiscountInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const startsAt = new Date().toISOString();
  const variables = {
    basicCodeDiscount: {
      title: input.title ?? `TrackQr · ${input.code}`,
      code:  input.code,
      startsAt,
      ...(input.endsAt ? { endsAt: input.endsAt.toISOString() } : {}),
      customerSelection: { all: true },
      // Shop-wide percentage discount on order subtotal.
      customerGets: {
        value: { percentage: input.percentage },
        items: { all: true },
      },
      ...(input.usageLimit ? { usageLimit: input.usageLimit } : {}),
      appliesOncePerCustomer: false,
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    },
  };

  try {
    const res = await admin.graphql(MUTATION, { variables });
    const json = await res.json() as {
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id: string } | null;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      };
    };
    const payload = json.data?.discountCodeBasicCreate;
    if (!payload) return { ok: false, error: "No response from Shopify" };
    if (payload.userErrors.length > 0) {
      return { ok: false, error: payload.userErrors.map(e => e.message).join("; ") };
    }
    const id = payload.codeDiscountNode?.id ?? "";
    return id ? { ok: true, id } : { ok: false, error: "Discount not created" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "GraphQL error" };
  }
}
