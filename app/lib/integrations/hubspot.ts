/** HubSpot "Create or update a contact" — v3 CRM API */
export interface HubspotSubscribeInput {
  apiKey: string; // PAT (private app access token)
  email: string;
  properties?: Record<string, string>;
}

export async function hubspotSubscribe({ apiKey, email, properties }: HubspotSubscribeInput): Promise<void> {
  const url = `https://api.hubapi.com/crm/v3/objects/contacts`;
  const body = {
    properties: { email, ...(properties ?? {}) },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) return; // already exists — treat as success
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot subscribe failed: ${res.status} ${text}`);
  }
}
