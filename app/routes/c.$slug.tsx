import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { getCampaignBySlug } from "../lib/campaign.server";
import { captureLead } from "../lib/leads.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (!params.slug) throw new Response("Not found", { status: 404 });
  const campaign = await getCampaignBySlug(params.slug);
  if (!campaign) throw new Response("Not found", { status: 404 });

  if (campaign.status === "DRAFT") {
    throw new Response("This campaign is not published yet.", { status: 423 });
  }
  if (campaign.status === "PAUSED") {
    throw new Response("This campaign is paused.", { status: 423 });
  }
  if (campaign.status === "ENDED") {
    throw new Response("This campaign has ended.", { status: 410 });
  }

  return {
    name: campaign.name,
    slug: campaign.slug,
    blocks: campaign.blocks as Array<{ id: string; type: string; props: Record<string, unknown>; layout?: { padding: string; align: string; bg: string }; visibility?: { mobile: boolean; desktop: boolean } }>,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!params.slug) return { ok: false, error: "missing-slug" } as const;
  const campaign = await getCampaignBySlug(params.slug);
  if (!campaign) return { ok: false, error: "not-found" } as const;
  if (campaign.status !== "ACTIVE") return { ok: false, error: "inactive" } as const;

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const destination = String(form.get("destination") ?? "db");
  const extra: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k === "email" || k === "destination") continue;
    extra[k] = String(v);
  }

  try {
    await captureLead({
      campaign,
      shopId: campaign.shopId,
      email,
      destination,
      extra,
      sourceIp: request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? null,
      sourceUa: request.headers.get("User-Agent") ?? null,
    });
    return { ok: true } as const;
  } catch (err) {
    return { ok: false, error: "save-failed", message: err instanceof Error ? err.message : "" } as const;
  }
};

/* ──────────── SSR rendering ──────────── */

function renderBlock(b: { type: string; props: Record<string, unknown> }, slug: string, fetcher: ReturnType<typeof useFetcher>) {
  const p = b.props ?? {};
  switch (b.type) {
    case "hero":
      return (
        <section className="tqr-hero">
          {!!p.eyebrow &&<div className="tqr-eyebrow">{String(p.eyebrow)}</div>}
          <h1>{String(p.title ?? "")}</h1>
          {!!p.subtitle &&<p>{String(p.subtitle)}</p>}
          {!!p.cta &&<button className="tqr-btn primary">{String(p.cta)} →</button>}
        </section>
      );
    case "timer": {
      const parts = String(p.endsIn ?? "00 · 00 · 00 · 00").split("·").map(s => s.trim());
      const labels = ["Days", "Hours", "Min", "Sec"];
      return (
        <section className="tqr-block">
          {!!p.label &&<div className="tqr-eyebrow center">{String(p.label)}</div>}
          <div className="tqr-timer">
            {parts.map((part, i) => (
              <div key={i}><div className="num">{part}</div><div className="lbl">{labels[i]}</div></div>
            ))}
          </div>
        </section>
      );
    }
    case "promo":
      return (
        <section className="tqr-block">
          {!!p.eyebrow &&<div className="tqr-eyebrow">{String(p.eyebrow)}</div>}
          <div className="tqr-promo">{String(p.code ?? "")}</div>
          <p>{String(p.title ?? "")}</p>
        </section>
      );
    case "capture":
      return (
        <section className="tqr-block tqr-capture">
          <h3>{String(p.title ?? "Get on the list")}</h3>
          {!!p.subtitle &&<p>{String(p.subtitle)}</p>}
          <fetcher.Form method="post">
            <input type="hidden" name="destination" value={String(p.destination ?? "db")} />
            <input type="email" name="email" required placeholder={String(p.placeholder ?? "you@email.com")} />
            <button type="submit" className="tqr-btn primary" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "…" : String(p.cta ?? "Notify me")}
            </button>
          </fetcher.Form>
          {!!(fetcher.data && (fetcher.data as { ok?: boolean }).ok) && <div className="tqr-success">Thanks — you're on the list.</div>}
        </section>
      );
    case "text":
      return (
        <section className="tqr-block">
          {!!p.heading &&<h2>{String(p.heading)}</h2>}
          {!!p.body &&<p style={{ whiteSpace: "pre-line" }}>{String(p.body)}</p>}
        </section>
      );
    case "button":
      return (
        <section className="tqr-block center">
          <a href={String(p.href ?? "#")} className={`tqr-btn ${String(p.variant ?? "primary")}`}>{String(p.label ?? "")}</a>
        </section>
      );
    case "image":
      return (
        <section className="tqr-block">
          {p.src ? <img src={String(p.src)} alt={String(p.alt ?? "")} style={{ width: "100%", borderRadius: 8 }} /> :
            <div className="tqr-placeholder">Image placeholder</div>}
          {!!p.caption &&<div className="tqr-caption">{String(p.caption)}</div>}
        </section>
      );
    case "video":
      return (
        <section className="tqr-block">
          {!!p.title &&<h3>{String(p.title)}</h3>}
          {p.src ? <iframe src={String(p.src)} style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 8 }} allowFullScreen /> :
            <div className="tqr-placeholder">Video placeholder</div>}
        </section>
      );
    case "urgency":
      return <div className={`tqr-urgency ${String(p.tone ?? "danger")}`}>⚠ <b>{String(p.label ?? "")}</b> {String(p.message ?? "")}</div>;
    case "faq": {
      const items = (p.items as Array<{ q: string; a: string }>) ?? [];
      return (
        <section className="tqr-block">
          {!!p.title &&<h2>{String(p.title)}</h2>}
          {items.map((it, i) => (
            <details key={i} open={!!p.expanded || i === 0}>
              <summary>{it.q}</summary>
              <p>{it.a}</p>
            </details>
          ))}
        </section>
      );
    }
    case "reviews": {
      const items = (p.items as Array<{ name: string; rating: number; text: string; verified?: boolean }>) ?? [];
      return (
        <section className="tqr-block">
          {!!p.title &&<h2 style={{ textAlign: "center" }}>{String(p.title)}</h2>}
          <div className="tqr-reviews">
            {items.map((r, i) => (
              <div key={i} className="tqr-review">
                <div className="stars">{"★".repeat(r.rating || 5)}</div>
                <p>"{r.text}"</p>
                <div className="name">— {r.name}{r.verified ? " · ✓ Verified" : ""}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "qr":
      return (
        <section className="tqr-block center">
          {!!p.title &&<h3>{String(p.title)}</h3>}
          {!!p.subtitle &&<p>{String(p.subtitle)}</p>}
          <div className="tqr-placeholder" style={{ aspectRatio: "1", maxWidth: 200, margin: "0 auto" }}>QR</div>
        </section>
      );
    case "products":
      return (
        <section className="tqr-block">
          <h2>{String(p.title ?? "Featured")}</h2>
          <p className="tqr-caption">Product grid renders live in Shopify themes — preview only here.</p>
        </section>
      );
    default:
      return null;
  }
}

export default function CampaignLanding() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{data.name} · TrackQr</title>
        <style>{css}</style>
      </head>
      <body>
        <main className="tqr-page">
          {data.blocks.length === 0 ? (
            <section className="tqr-block center">
              <h1>{data.name}</h1>
              <p>This campaign has no blocks yet.</p>
            </section>
          ) : data.blocks.map(b => (
            <div key={b.id}>{renderBlock(b, data.slug, fetcher)}</div>
          ))}
          <footer className="tqr-foot">
            <span>Powered by <a href="https://trackqr.app">TrackQr</a></span>
          </footer>
        </main>
      </body>
    </html>
  );
}

const css = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Inter", sans-serif; margin: 0; background: #0B1220; color: #E2E8F0; line-height: 1.5; }
  .tqr-page { max-width: 640px; margin: 0 auto; padding: 0 16px 48px; }
  .tqr-block { padding: 28px 0; }
  .tqr-block.center { text-align: center; }
  .tqr-eyebrow { display: inline-block; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #8B92A8; margin-bottom: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
  .tqr-eyebrow.center { text-align: center; }
  .tqr-hero { padding: 48px 0 32px; text-align: center; }
  .tqr-hero h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 40px; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 12px; color: #fff; }
  .tqr-hero p { color: #9DA4B8; font-size: 17px; max-width: 480px; margin: 0 auto 24px; }
  h2 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 28px; letter-spacing: -0.018em; margin: 0 0 14px; color: #fff; }
  h3 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 22px; margin: 0 0 10px; color: #fff; }
  p  { margin: 0 0 14px; }
  a  { color: #93C5FD; }
  .tqr-btn { display: inline-block; padding: 12px 22px; border-radius: 10px; font-weight: 500; font-size: 14px; cursor: pointer; border: 0; text-decoration: none; }
  .tqr-btn.primary { background: linear-gradient(135deg, #2563EB, #7C3AED); color: #fff; }
  .tqr-btn.secondary { background: rgba(255,255,255,0.10); color: #fff; border: 1px solid rgba(255,255,255,0.18); }
  .tqr-btn.outline { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.24); }
  .tqr-btn.ghost { background: transparent; color: #93C5FD; }
  .tqr-timer { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .tqr-timer > div { background: rgba(255,255,255,0.06); padding: 14px 10px; border-radius: 10px; text-align: center; }
  .tqr-timer .num { font-family: "Instrument Serif", serif; font-size: 32px; color: #fff; }
  .tqr-timer .lbl { font-size: 10px; color: #8B92A8; text-transform: uppercase; letter-spacing: 0.08em; font-family: ui-monospace, monospace; }
  .tqr-promo { font-family: ui-monospace, monospace; letter-spacing: 0.08em; font-size: 28px; background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.2); padding: 18px; border-radius: 10px; text-align: center; }
  .tqr-capture form { display: flex; gap: 8px; margin-top: 14px; }
  .tqr-capture input { flex: 1; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #fff; font-size: 14px; }
  .tqr-success { color: #4ADE80; margin-top: 10px; font-size: 13px; }
  .tqr-urgency { background: rgba(220,38,38,0.18); border: 1px solid rgba(220,38,38,0.3); padding: 10px 14px; border-radius: 10px; font-size: 13px; }
  .tqr-urgency.warning { background: rgba(245,158,11,0.18); border-color: rgba(245,158,11,0.3); }
  .tqr-urgency.info    { background: rgba(37,99,235,0.18); border-color: rgba(37,99,235,0.3); }
  .tqr-placeholder { background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px; aspect-ratio: 16/9; display: grid; place-items: center; color: #8B92A8; font-size: 13px; }
  .tqr-caption { color: #8B92A8; font-size: 12px; text-align: center; margin-top: 6px; }
  .tqr-reviews { display: grid; gap: 12px; }
  .tqr-review { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 16px; }
  .tqr-review .stars { color: #FBBF24; }
  .tqr-review .name { color: #8B92A8; font-size: 12px; margin-top: 8px; }
  details { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; }
  details summary { cursor: pointer; font-weight: 500; }
  details p { color: #9DA4B8; margin: 8px 0 0; }
  .tqr-foot { text-align: center; color: #5B6172; font-size: 12px; padding: 32px 0 12px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 32px; }
`;
