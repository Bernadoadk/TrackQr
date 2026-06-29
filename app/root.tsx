import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";
import { RouteError } from "./components/RouteError";
import globalStyles from "./styles/globals.css?url";

export function links() {
  return [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      rel: "stylesheet",
      href:
        "https://fonts.googleapis.com/css2" +
        // Sans-serif
        "?family=Inter:ital,opsz,wght@0,14..32,300..700;1,14..32,300..700" +
        "&family=Roboto:ital,wght@0,400;0,500;0,700;1,400" +
        "&family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400" +
        "&family=Lato:ital,wght@0,400;0,700;1,400" +
        "&family=Montserrat:ital,wght@0,400;0,600;0,700;1,400" +
        "&family=Poppins:ital,wght@0,400;0,600;0,700;1,400" +
        "&family=Raleway:ital,wght@0,400;0,600;0,700;1,400" +
        "&family=DM+Sans:ital,wght@0,400;0,600;0,700;1,400" +
        "&family=Nunito:ital,wght@0,400;0,700;1,400" +
        "&family=Work+Sans:ital,wght@0,400;0,600;0,700;1,400" +
        // Display
        "&family=Bebas+Neue" +
        "&family=Anton" +
        "&family=Oswald:wght@400;600;700" +
        "&family=Archivo+Black" +
        "&family=Abril+Fatface" +
        "&family=Righteous" +
        "&family=Bungee" +
        "&family=Staatliches" +
        // Serif
        "&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500" +
        "&family=Merriweather:ital,wght@0,400;0,700;1,400" +
        "&family=Lora:ital,wght@0,400;0,600;0,700;1,400" +
        "&family=EB+Garamond:ital,wght@0,400;0,600;1,400" +
        "&family=Instrument+Serif:ital@0;1" +
        "&family=DM+Serif+Display:ital@0;1" +
        "&family=PT+Serif:ital,wght@0,400;0,700;1,400" +
        "&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500" +
        "&family=Roboto+Slab:wght@400;500;600;700" +
        // Script / Handwriting
        "&family=Lobster" +
        "&family=Caveat:wght@500;700" +
        "&family=Permanent+Marker" +
        "&family=Pacifico" +
        "&family=Dancing+Script:wght@400;600;700" +
        "&family=Great+Vibes" +
        "&family=Sacramento" +
        "&family=Satisfy" +
        // Monospace
        "&family=JetBrains+Mono:wght@400;500;600;700" +
        "&family=Fira+Code:wght@400;500;700" +
        "&family=Space+Mono:ital,wght@0,400;0,700;1,400" +
        "&family=Roboto+Mono:ital,wght@0,400;0,500;0,700;1,400" +
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

export function ErrorBoundary() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <RouteError error={useRouteError()} />
        <Scripts />
      </body>
    </html>
  );
}
