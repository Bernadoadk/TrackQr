import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { registerDictionary } from "./lib/i18n";

/**
 * Admin pages are rendered in the merchant's language (root.tsx sets
 * data-admin-locale). Fetch that dictionary — and only that one — before
 * hydrating, so the first client render matches the server HTML.
 */
async function loadAdminDictionary() {
  const locale = document.documentElement.dataset.adminLocale;
  if (locale === "fr") registerDictionary("fr", (await import("./locales/fr")).fr);
  else if (locale === "es") registerDictionary("es", (await import("./locales/es")).es);
}

loadAdminDictionary()
  // A failed download falls back to English rather than leaving the app inert.
  .catch(error => console.error("[i18n] dictionary not loaded", error))
  .finally(() => {
    startTransition(() => {
      hydrateRoot(
        document,
        <StrictMode>
          <HydratedRouter />
        </StrictMode>,
      );
    });
  });
