import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

const LISTING_URL = "https://apps.shopify.com/trackqr?utm_source=trackqr&utm_medium=website&utm_campaign=home";

export const meta: MetaFunction = () => [
  { title: "TrackQr — QR codes that prove sales, for Shopify" },
  { name: "description", content: "Dynamic, branded QR codes for Shopify: track every scan, capture leads on campaign pages and see the orders each code brings." },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

const FEATURES = [
  { title: "Dynamic & branded", text: "Product, collection, cart, promo or any link — change the destination any time, no reprint. Logo, colors, frames." },
  { title: "Every scan counted", text: "Devices, countries, unique visitors, and never an error page: paused codes fall back to your store." },
  { title: "Sales, not just scans", text: "Campaign pages with email capture, and the Shopify orders and revenue each QR code brings." },
];

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div className={styles.brand}>
          <img src="/TrackQr.png" alt="" width={40} height={40} />
          <span>TrackQr</span>
        </div>
        <h1 className={styles.heading}>QR codes that <em>prove sales</em>.</h1>
        <p className={styles.text}>
          Create trackable QR codes for your Shopify store, launch campaign pages that capture leads, and see the orders and revenue every printed code brings.
        </p>
        <div className={styles.actions}>
          <a className={styles.primary} href={LISTING_URL}>Install on the Shopify App Store</a>
        </div>
        <ul className={styles.list}>
          {FEATURES.map(f => (
            <li key={f.title}>
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Already installed? Log in with your shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="my-shop-domain.myshopify.com" />
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
