import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import globalStyles from "./styles/globals.css?url";

export function links() {
  return [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      rel: "stylesheet",
      href:
        "https://fonts.googleapis.com/css2" +
        "?family=Inter:ital,opsz,wght@0,14..32,300..700;1,14..32,300..700" +
        "&family=Instrument+Serif:ital@0;1" +
        "&family=JetBrains+Mono:wght@400;500;600" +
        "&family=Playfair+Display:wght@500;600;700" +
        "&family=Bebas+Neue" +
        "&family=Anton" +
        "&family=Lobster" +
        "&family=Caveat:wght@500;700" +
        "&family=Permanent+Marker" +
        "&family=Pacifico" +
        "&family=Oswald:wght@500;600" +
        "&family=Roboto+Slab:wght@500;600" +
        "&display=swap",
    },
    { rel: "stylesheet", href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css" },
    { rel: "stylesheet", href: globalStyles },
  ];
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
