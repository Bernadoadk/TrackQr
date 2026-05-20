// data.jsx — Realistic mock data shared across views.

const QR_TYPES = [
  { id: "home",     name: "Homepage",        icon: "home",          group: "shopify", url: "/" },
  { id: "product",  name: "Product page",    icon: "package",       group: "shopify", url: "/products/aurora-tee" },
  { id: "link",     name: "Link",            icon: "link",          group: "shopify", url: "https://" },
  { id: "atc",      name: "Add to cart",     icon: "shopping-cart", group: "shopify", url: "/cart/add" },
  { id: "promo",    name: "Promo code",      icon: "tag",           group: "shopify", url: "/discount/" },
  { id: "url",      name: "Custom URL",      icon: "globe",         group: "custom",  url: "https://" },
  { id: "text",     name: "Text",            icon: "type",          group: "custom" },
  { id: "phone",    name: "Phone",           icon: "phone",         group: "custom" },
  { id: "sms",      name: "SMS",             icon: "message-square",group: "custom" },
  { id: "email",    name: "Email",           icon: "mail",          group: "custom" },
  { id: "wifi",     name: "WiFi",            icon: "wifi",          group: "custom" },
  { id: "vcard",    name: "vCard",           icon: "id-card",       group: "custom" },
];

function typeMeta(id) { return QR_TYPES.find(t => t.id === id) || QR_TYPES[0]; }

const QR_CODES = [
  { id: "qr_01", name: "Summer drop · Hero banner",        type: "product", scans: 4218, conversions: 312, createdAt: Date.now() - 4 * 86400000, active: true,  url: "/products/aurora-tee", color: "#0B1220" },
  { id: "qr_02", name: "Free shipping · Checkout flyer",   type: "promo",   scans: 2864, conversions: 198, createdAt: Date.now() - 6 * 86400000, active: true,  url: "/discount/FREESHIP", color: "#2563EB" },
  { id: "qr_03", name: "In-store WiFi guest access",       type: "wifi",    scans: 1932, conversions: 0,   createdAt: Date.now() - 9 * 86400000, active: true,  url: "wifi:AuroraGuest", color: "#7C3AED" },
  { id: "qr_04", name: "Receipt · Leave a review",         type: "url",     scans: 1604, conversions: 412, createdAt: Date.now() - 12 * 86400000, active: true,  url: "https://reviews.aurora.co/r", color: "#16A34A" },
  { id: "qr_05", name: "Catalog · Spring 2026",            type: "home",    scans: 1311, conversions: 58,  createdAt: Date.now() - 14 * 86400000, active: true,  url: "/", color: "#D97706" },
  { id: "qr_06", name: "Pop-up event · NYC SoHo",          type: "url",     scans: 902,  conversions: 144, createdAt: Date.now() - 18 * 86400000, active: false, url: "https://aurora.co/event/nyc", color: "#0B1220" },
  { id: "qr_07", name: "Loyalty signup · Cashier",         type: "url",     scans: 786,  conversions: 89,  createdAt: Date.now() - 22 * 86400000, active: true,  url: "https://aurora.co/rewards", color: "#DB2777" },
  { id: "qr_08", name: "Customer service · Quick contact", type: "phone",   scans: 412,  conversions: 0,   createdAt: Date.now() - 28 * 86400000, active: true,  url: "tel:+18002787622", color: "#0B1220" },
  { id: "qr_09", name: "Holiday gift guide",               type: "link",    scans: 287,  conversions: 31,  createdAt: Date.now() - 35 * 86400000, active: false, url: "/collections/gift-guide", color: "#2563EB" },
];

const CAMPAIGNS = [
  { id: "cmp_01", name: "Black Friday · Door buster",  description: "Limited-time hero with countdown timer and email capture.", status: "active",  scans: 8420, leads: 1284, conversions: 312, convRate: 3.70, start: "Nov 24, 2025", end: "Nov 28, 2025" },
  { id: "cmp_02", name: "Spring collection launch",    description: "Three-product showcase + bonus discount on email signup.",  status: "active",  scans: 5128, leads: 712,  conversions: 198, convRate: 3.86, start: "Mar 01, 2026", end: "Apr 15, 2026" },
  { id: "cmp_03", name: "Wholesale partner waitlist",  description: "Lead-gen page for B2B applications via QR on tradeshow swag.", status: "paused",  scans: 1942, leads: 384, conversions: 22, convRate: 1.13, start: "Feb 12, 2026", end: "Apr 30, 2026" },
  { id: "cmp_04", name: "VIP early access · April",    description: "Member-only preview, age-gated entry, exclusive promo code.", status: "draft",  scans: 0,    leads: 0,    conversions: 0,   convRate: 0,    start: "Apr 22, 2026", end: "Apr 24, 2026" },
  { id: "cmp_05", name: "Q1 customer review request",  description: "Post-purchase review collection via packaging insert QR.",    status: "ended",  scans: 12044, leads: 0,    conversions: 1244, convRate: 10.33, start: "Jan 02, 2026", end: "Mar 31, 2026" },
];

const ACTIVITY = [
  { id: 1, kind: "scan",       title: "Aurora Tee QR scanned",                  who: "iPhone · Brooklyn, NY",       time: Date.now() - 6 * 1000,  tone: "green",  live: true },
  { id: 2, kind: "conversion", title: "Conversion · $84.00",                     who: "Free shipping QR",            time: Date.now() - 42 * 1000, tone: "blue" },
  { id: 3, kind: "lead",       title: "Email captured · jordan.l@…",            who: "Spring launch · Hero block",  time: Date.now() - 3 * 60000, tone: "violet" },
  { id: 4, kind: "scan",       title: "WiFi QR scanned",                         who: "Android · Austin, TX",        time: Date.now() - 7 * 60000, tone: "amber" },
  { id: 5, kind: "scan",       title: "Spring collection scanned",               who: "iPhone · Paris, FR",          time: Date.now() - 14 * 60000, tone: "green" },
  { id: 6, kind: "campaign",   title: "Black Friday · Door buster published",    who: "by you · 2 hours ago",        time: Date.now() - 2 * 3600000, tone: "blue" },
  { id: 7, kind: "conversion", title: "Conversion · $246.00",                    who: "VIP early access QR",         time: Date.now() - 3 * 3600000, tone: "green" },
];

function activityIcon(kind) {
  switch (kind) {
    case "scan": return "scan";
    case "conversion": return "credit-card";
    case "lead": return "mail";
    case "campaign": return "megaphone";
    default: return "info";
  }
}

const SCANS_30D = [
  82, 91, 76, 124, 168, 142, 110, 138, 196, 244,
  211, 188, 173, 218, 286, 312, 274, 248, 296, 340,
  368, 392, 410, 376, 348, 388, 442, 488, 510, 466,
];

const SPARK_QR    = [12, 14, 13, 18, 22, 19, 24, 28, 26, 30, 34, 32, 38, 42];
const SPARK_SCANS = [186, 218, 244, 211, 263, 312, 296, 348, 388, 412, 466, 488, 510, 542];
const SPARK_CONV  = [22, 28, 25, 31, 38, 34, 42, 48, 44, 51, 58, 62, 68, 72];
const SPARK_RATE  = [3.1, 3.4, 3.2, 3.6, 3.8, 3.5, 3.9, 4.2, 4.0, 4.3, 4.5, 4.4, 4.6, 4.8];

const COUNTRIES = [
  { flag: "🇺🇸", name: "United States", value: 4218, pct: 38.4 },
  { flag: "🇨🇦", name: "Canada",        value: 1864, pct: 17.0 },
  { flag: "🇬🇧", name: "United Kingdom",value: 1422, pct: 13.0 },
  { flag: "🇫🇷", name: "France",        value: 928,  pct: 8.5 },
  { flag: "🇩🇪", name: "Germany",       value: 712,  pct: 6.5 },
  { flag: "🇦🇺", name: "Australia",     value: 612,  pct: 5.6 },
  { flag: "🇯🇵", name: "Japan",         value: 388,  pct: 3.5 },
];

const DEVICES = [
  { name: "Mobile",  value: 7682, pct: 70.1, icon: "smartphone" },
  { name: "Desktop", value: 2418, pct: 22.0, icon: "monitor" },
  { name: "Tablet",  value: 866,  pct: 7.9,  icon: "tablet" },
];

const TOP_QRS = [
  { name: "Summer drop · Hero",     value: 4218 },
  { name: "Free shipping flyer",    value: 2864 },
  { name: "In-store WiFi access",   value: 1932 },
  { name: "Receipt review request", value: 1604 },
  { name: "Catalog · Spring 26",    value: 1311 },
];

const RECENT_SCANS = [
  { qr: "Summer drop · Hero",      type: "product", time: "12s ago",  loc: "Brooklyn, US",    device: "iPhone",      result: "Conversion" },
  { qr: "Free shipping flyer",     type: "promo",   time: "1m ago",   loc: "Toronto, CA",     device: "Pixel 8",     result: "Visit" },
  { qr: "Catalog · Spring 26",     type: "home",    time: "3m ago",   loc: "Paris, FR",       device: "iPhone",      result: "Visit" },
  { qr: "In-store WiFi access",    type: "wifi",    time: "5m ago",   loc: "Austin, US",      device: "Galaxy S24",  result: "Connected" },
  { qr: "Receipt review request",  type: "url",     time: "8m ago",   loc: "London, UK",      device: "MacBook",     result: "Review" },
  { qr: "Customer service",        type: "phone",   time: "12m ago",  loc: "Berlin, DE",      device: "iPhone",      result: "Call" },
  { qr: "Summer drop · Hero",      type: "product", time: "14m ago",  loc: "Sydney, AU",      device: "Pixel 8",     result: "Visit" },
];

const LEADS = [
  { email: "jordan.lewis@catalyst.io",     date: "Today, 14:32",    source: "Hero block" },
  { email: "amelia.chen@finchlabs.com",    date: "Today, 13:08",    source: "Footer signup" },
  { email: "ben.kowalski@northstack.dev",  date: "Today, 11:51",    source: "Hero block" },
  { email: "priya@studiowren.co",          date: "Today, 09:14",    source: "Promo gate" },
  { email: "marc.dubois@atelier-rive.fr",  date: "Yesterday, 22:46",source: "Hero block" },
  { email: "haruki.tanaka@oishi.jp",       date: "Yesterday, 18:02",source: "Footer signup" },
  { email: "olivia.müller@kraft.de",       date: "Yesterday, 16:39",source: "Hero block" },
];

const BLOCK_LIBRARY = [
  { id: "hero",      name: "Hero section",   icon: "image",            tone: "blue" },
  { id: "timer",     name: "Countdown timer",icon: "clock",            tone: "amber" },
  { id: "products",  name: "Product grid",   icon: "grid",             tone: "blue" },
  { id: "capture",   name: "Email capture",  icon: "mail",             tone: "violet" },
  { id: "promo",     name: "Promo code",     icon: "tag",              tone: "amber" },
  { id: "image",     name: "Image / gallery",icon: "image",            tone: "neutral" },
  { id: "video",     name: "Video",          icon: "video",            tone: "neutral" },
  { id: "text",      name: "Text block",     icon: "type",             tone: "neutral" },
  { id: "reviews",   name: "Reviews",        icon: "star",             tone: "amber" },
  { id: "faq",       name: "FAQ",            icon: "help-circle",      tone: "neutral" },
  { id: "urgency",   name: "Urgency banner", icon: "alert-triangle",   tone: "danger" },
  { id: "qr",        name: "QR code block",  icon: "qr-code",          tone: "blue" },
  { id: "button",    name: "Button",         icon: "mouse-pointer-click", tone: "neutral" },
];

function blockMeta(id) { return BLOCK_LIBRARY.find(b => b.id === id); }

Object.assign(window, {
  QR_TYPES, typeMeta, QR_CODES, CAMPAIGNS, ACTIVITY, activityIcon,
  SCANS_30D, SPARK_QR, SPARK_SCANS, SPARK_CONV, SPARK_RATE,
  COUNTRIES, DEVICES, TOP_QRS, RECENT_SCANS, LEADS,
  BLOCK_LIBRARY, blockMeta,
});
