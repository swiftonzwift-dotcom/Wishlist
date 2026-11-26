// Link helpers and item previews (picture + name from a store link).

/** Returns a clean http(s) URL, or "" if the text isn't a safe web link. */
export function safeUrl(u) {
  try {
    const x = new URL(String(u || "").trim());
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : "";
  } catch {
    return "";
  }
}

/**
 * Turns whatever someone pasted into a link. Handles "share" text from store
 * apps (e.g. "Check out this item! https://...") and links without https://.
 */
export function normalizeUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/https?:\/\/[^\s<>"']+/i);
  if (m) s = m[0];
  else if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) s = "https://" + s;
  return safeUrl(s);
}

export function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const SITE_NAMES = {
  "amazon.com": "Amazon", "amazon.ca": "Amazon", "amazon.co.uk": "Amazon", "a.co": "Amazon", "amzn.to": "Amazon",
  "target.com": "Target", "walmart.com": "Walmart", "etsy.com": "Etsy", "ebay.com": "eBay",
  "bestbuy.com": "Best Buy", "costco.com": "Costco", "kohls.com": "Kohl's", "rei.com": "REI",
  "nordstrom.com": "Nordstrom", "macys.com": "Macy's", "lego.com": "LEGO", "apple.com": "Apple",
  "homedepot.com": "Home Depot", "lowes.com": "Lowe's", "wayfair.com": "Wayfair", "ikea.com": "IKEA",
  "barnesandnoble.com": "Barnes & Noble", "bookshop.org": "Bookshop", "uncommongoods.com": "Uncommon Goods",
};

export function siteNameFor(u) {
  const h = hostOf(u);
  if (!h) return "";
  if (SITE_NAMES[h]) return SITE_NAMES[h];
  const parts = h.split(".");
  const core = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function tidyTitle(t) {
  return String(t || "")
    .replace(/^Amazon\.[a-z.]+\s*:\s*/i, "")
    .replace(/\s*[|:-]\s*(Amazon|Target|Walmart|Etsy|eBay|Best Buy)(\.[a-z.]+)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

/**
 * Asks a free link-preview service (microlink.io) for the item's picture and
 * name. Some stores block this; in that case we return what we can and the
 * person just types the name themselves.
 */
export async function fetchPreview(url) {
  const out = { title: "", image: "", siteName: siteNameFor(url), price: "" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch("https://api.microlink.io/?url=" + encodeURIComponent(url), { signal: ctrl.signal });
    const j = await r.json();
    if (j && j.status === "success" && j.data) {
      const d = j.data;
      out.title = tidyTitle(d.title);
      const img = safeUrl(d.image && d.image.url);
      // Ignore tiny logos/sprites that some stores return instead of a product photo.
      const big = !d.image || !d.image.width || d.image.width >= 120;
      if (img && big) out.image = img;
      if (d.publisher && !SITE_NAMES[hostOf(url)]) out.siteName = String(d.publisher).slice(0, 40);
    }
  } catch {
    /* offline, blocked or timed out: fine, the person can type the details */
  } finally {
    clearTimeout(timer);
  }
  if (out.title && /robot|captcha|access denied|page not found|sign in/i.test(out.title)) out.title = "";
  return out;
}
