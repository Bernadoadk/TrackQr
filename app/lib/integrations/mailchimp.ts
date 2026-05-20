import crypto from "node:crypto";

/** Mailchimp "Add or Update Member" — PUT /3.0/lists/:listId/members/:hash */
export interface MailchimpSubscribeInput {
  apiKey: string; // datacenter is encoded in the apiKey suffix (e.g. "us20-abc")
  listId: string;
  email: string;
  fields?: Record<string, string>;
}

export async function mailchimpSubscribe({ apiKey, listId, email, fields }: MailchimpSubscribeInput): Promise<void> {
  const dc = apiKey.split("-")[1];
  if (!dc) throw new Error("Mailchimp API key missing datacenter suffix");
  const hash = crypto.createHash("md5").update(email.toLowerCase()).digest("hex");
  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}/members/${hash}`;
  const body = {
    email_address: email,
    status_if_new: "subscribed",
    merge_fields: fields ?? {},
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mailchimp subscribe failed: ${res.status} ${text}`);
  }
}
