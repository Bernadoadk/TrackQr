import type { HeadersFunction } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Card } from "../components/ui/Card";

export default function AdditionalPage() {
  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-h1">Additional <span className="em">page</span></h1>
          <div className="page-sub">This page is part of your Shopify app.</div>
        </div>
        <div className="page-head-actions">
          <Link to="/app"><Button variant="secondary" icon="arrow-left">Dashboard</Button></Link>
        </div>
      </div>
      <Card className="card-pad">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", gap: 14, textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
            <Icon name="layers" size={24} />
          </div>
          <div style={{ fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 18, color: "var(--fg-strong)", letterSpacing: "-0.015em" }}>Additional page</div>
          <div style={{ fontSize: 13.5, color: "var(--fg-muted)", maxWidth: 440, lineHeight: 1.6 }}>
            This page demonstrates multi-page navigation in a Shopify embedded app. Add routes under <code>app/routes/app.*.tsx</code> and they will appear here.
          </div>
        </div>
      </Card>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
