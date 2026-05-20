/** Klaviyo "Add to List" — POST /api/v2/list/:listId/subscribe */
export interface KlaviyoSubscribeInput {
  apiKey: string;
  listId: string;
  email: string;
  properties?: Record<string, string>;
}

export async function klaviyoSubscribe({ apiKey, listId, email, properties }: KlaviyoSubscribeInput): Promise<void> {
  const url = `https://a.klaviyo.com/api/v2/list/${encodeURIComponent(listId)}/subscribe?api_key=${encodeURIComponent(apiKey)}`;
  const body = {
    profiles: [{ email, ...(properties ?? {}) }],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Klaviyo subscribe failed: ${res.status} ${text}`);
  }
}
