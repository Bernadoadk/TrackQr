/* TrackQr attribution — runs on every storefront page once the app embed is enabled.
 * 1. A QR scan lands with ?attributes[tqr_scan]=…&attributes[tqr_qr]=… (or plain
 *    ?tqr_scan=… after a /discount/ redirect). Remember it for 7 days.
 * 2. Make sure the cart carries those values as attributes, so the order's
 *    note_attributes let TrackQr match the sale back to the scan. */
(function () {
  var KEY = "tqr_attr";
  var TTL = 7 * 24 * 60 * 60 * 1000;

  function fromUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      var scan = p.get("attributes[tqr_scan]") || p.get("tqr_scan");
      var qr = p.get("attributes[tqr_qr]") || p.get("tqr_qr") || "";
      return scan ? { scan: scan, qr: qr, at: Date.now() } : null;
    } catch (e) { return null; }
  }
  function load() {
    try {
      var v = JSON.parse(window.localStorage.getItem(KEY) || "null");
      return v && v.scan && Date.now() - v.at < TTL ? v : null;
    } catch (e) { return null; }
  }
  function save(v) {
    try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  var fresh = fromUrl();
  if (fresh) save(fresh);
  var attr = fresh || load();
  if (!attr) return;

  // Idempotent: only write when the cart does not already carry this scan.
  fetch("/cart.js", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (cart) {
      var current = (cart && cart.attributes) || {};
      if (current.tqr_scan === attr.scan) return;
      return fetch("/cart/update.js", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ attributes: { tqr_scan: attr.scan, tqr_qr: attr.qr } })
      });
    })
    .catch(function () { /* attribution must never break the storefront */ });
})();
