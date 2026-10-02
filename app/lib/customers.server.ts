import { unauthenticated } from "../shopify.server";

/**
 * Campaign leads → Shopify customers (Growth, optional `write_customers`
 * scope). Creates the customer when the email is unknown, tags it with the
 * campaign, and records email-marketing consent only when the visitor ticked
 * the consent box. Existing consent is never downgraded.
 */

export const CUSTOMER_SYNC_SCOPE = "write_customers";

type AdminClient = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];

async function gql<T>(admin: AdminClient, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  return (await response.json()) as T;
}

export async function hasGrantedScope(admin: AdminClient, scope: string): Promise<boolean> {
  const json = await gql<{ data?: { currentAppInstallation?: { accessScopes: { handle: string }[] } } }>(admin, `#graphql
    query TrackQrScopes {
      currentAppInstallation {
        accessScopes { handle }
      }
    }
  `);
  return (json.data?.currentAppInstallation?.accessScopes ?? []).some(s => s.handle === scope);
}

function tagFor(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export interface CustomerSyncResult {
  customerId: string | null;
  error?: string;
}

export async function syncLeadToCustomer(opts: {
  shopDomain: string;
  email: string;
  consent: boolean;
  campaignName: string;
  campaignSlug: string;
}): Promise<CustomerSyncResult> {
  try {
    const { admin } = await unauthenticated.admin(opts.shopDomain);
    if (!(await hasGrantedScope(admin, CUSTOMER_SYNC_SCOPE))) {
      return { customerId: null, error: "Customer access was not granted to TrackQr." };
    }
    const tags = ["TrackQr", `trackqr-${tagFor(opts.campaignSlug)}`];
    const escapedEmail = opts.email.replace(/["\\]/g, "");

    const existing = await gql<{
      data?: { customers?: { nodes: { id: string; defaultEmailAddress?: { marketingState?: string } | null }[] } };
    }>(admin, `#graphql
      query TrackQrCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes {
            id
            defaultEmailAddress { marketingState }
          }
        }
      }
    `, { query: `email:"${escapedEmail}"` });

    const found = existing.data?.customers?.nodes?.[0];
    if (found) {
      await gql(admin, `#graphql
        mutation TrackQrCustomerTags($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }
      `, { id: found.id, tags });
      const state = found.defaultEmailAddress?.marketingState;
      if (opts.consent && state !== "SUBSCRIBED") {
        await gql(admin, `#graphql
          mutation TrackQrCustomerConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
            customerEmailMarketingConsentUpdate(input: $input) {
              customer { id }
              userErrors { field message }
            }
          }
        `, {
          input: {
            customerId: found.id,
            emailMarketingConsent: {
              marketingState: "SUBSCRIBED",
              marketingOptInLevel: "SINGLE_OPT_IN",
              consentUpdatedAt: new Date().toISOString(),
            },
          },
        });
      }
      return { customerId: found.id };
    }

    const created = await gql<{
      data?: { customerCreate?: { customer?: { id: string } | null; userErrors: { message: string }[] } };
    }>(admin, `#graphql
      mutation TrackQrCustomerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `, {
      input: {
        email: opts.email,
        tags,
        note: `Lead captured by TrackQr on the "${opts.campaignName}" campaign page.`,
        ...(opts.consent
          ? {
              emailMarketingConsent: {
                marketingState: "SUBSCRIBED",
                marketingOptInLevel: "SINGLE_OPT_IN",
                consentUpdatedAt: new Date().toISOString(),
              },
            }
          : {}),
      },
    });
    const payload = created.data?.customerCreate;
    if (payload?.userErrors?.length) {
      return { customerId: null, error: payload.userErrors.map(e => e.message).join("; ") };
    }
    return { customerId: payload?.customer?.id ?? null };
  } catch (err) {
    return { customerId: null, error: err instanceof Error ? err.message.slice(0, 300) : "Customer sync failed" };
  }
}
