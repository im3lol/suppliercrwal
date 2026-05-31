#!/usr/bin/env python3
"""Crawleo AOD Crawler — Python HTTP Service on port 3002.

Uses Python's urllib (proven stable with Crawleo API).
The Node.js fetch/Bun fetch both crash with large Crawleo responses.
"""

import http.server
import json
import re
import sys
import urllib.request
import urllib.parse

REGIONS = {
    "COM": {"domain": "amazon.com", "currency": "USD", "geo": "us"},
    "EG":  {"domain": "amazon.eg",  "currency": "EGP", "geo": "eg"},
    "DE":  {"domain": "amazon.de",  "currency": "EUR", "geo": "de"},
    "SA":  {"domain": "amazon.sa",  "currency": "SAR", "geo": "sa"},
    "AE":  {"domain": "amazon.ae",  "currency": "AED", "geo": "ae"},
}

CURRENCY_SYMBOLS = {"USD": "$", "EUR": "\u20ac", "EGP": "EGP ", "SAR": "SAR ", "AED": "AED "}
CRAWLEO_API = "https://api.crawleo.dev/crawl"

# ── Price parsing ──

def parse_num(ns):
    ns = ns.strip()
    ld, lc = ns.rfind("."), ns.rfind(",")
    if ld > lc and ld > -1:
        fp = ns[ld+1:]
        wp = ns[:ld].replace(",", "").replace(".", "").replace(" ", "")
        if len(fp) in (1, 2):
            fp2 = fp if len(fp) == 2 else fp + "0"
            try:
                if float(f"{wp}.{fp2}") > 0: return f"{wp}.{fp2}"
            except: pass
    elif lc > ld and lc > -1:
        fp = ns[lc+1:]
        wp = ns[:lc].replace(",", "").replace(".", "").replace(" ", "")
        if len(fp) == 2:
            try:
                if float(f"{wp}.{fp}") > 0: return f"{wp}.{fp}"
            except: pass
        elif len(fp) == 3:
            try:
                if float(wp) > 0: return f"{wp}.00"
            except: pass
    return None

def extract_price(text, default_curr):
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("\u200e", "").replace("\u200f", "")
    text = re.sub(r"\s+(with|mit|\u0645\u0639)\s+\d+\s+(percent|Prozent|%)\s+(savings|Einsparungen|\u062a\u0648\u0641\u064a\u0631)", "", text, flags=re.IGNORECASE).strip()
    patterns = [
        (r"\$\s*([\d.,]+)", "USD"), (r"\u20ac\s*([\d.,]+)", "EUR"), (r"([\d.,]+)\s*\u20ac", "EUR"),
        (r"SAR\s*([\d.,]+)", "SAR"), (r"AED\s*([\d.,]+)", "AED"), (r"EGP\s*([\d.,]+)", "EGP"),
        (r"\u062c\u0646\u064a\u0647\s*([\d.,]+)", "EGP"), (r"([\d.,]+)\s*\u062c\u0646\u064a\u0647", "EGP"),
        (r"\u0631\u064a\u0627\u0644\s*([\d.,]+)", "SAR"), (r"([\d.,]+)\s*\u0631\u064a\u0627\u0644", "SAR"),
        (r"\u062f\u0631\u0647\u0645\s*([\d.,]+)", "AED"), (r"([\d.,]+)\s*\u062f\u0631\u0647\u0645", "AED"),
    ]
    for pat, curr in patterns:
        m = re.search(pat, text)
        if m:
            pr = parse_num(m.group(1))
            if pr: return (pr, curr)
    return None

def parse_price(html, default_curr):
    h = html.replace("\u200e", "").replace("\u200f", "")
    om = re.search(r'id="aod-total-offer-count"[^>]*value="(\d+)"', h) or re.search(r'value="(\d+)"[^>]*id="aod-total-offer-count"', h)
    total = int(om.group(1)) if om else -1
    pe = re.findall(r'id="aod-price-\d+"', h)
    if total == 0 and len(pe) == 0:
        return "N/A", default_curr
    for m in re.finditer(r'<span[^>]*class="[^"]*aok-offscreen[^"]*apex-pricetopay[^"]*"[^>]*>\s*([^<]+?)\s*</span>', h):
        pr = extract_price(m.group(1).strip(), default_curr)
        if pr: return pr
    for m in re.finditer(r'<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+?)\s*</span>', h):
        pr = extract_price(m.group(1).strip(), default_curr)
        if pr:
            try:
                if float(pr[0]) >= 0.5: return pr
            except: pass
    return "N/A", default_curr

def parse_name(html):
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.IGNORECASE)
    if m:
        n = m.group(1).strip()
        n = re.sub(r"\s*[:|]\s*Amazon\.\w+\s*$", "", n)
        n = re.sub(r"\s+\d+[.,]\d+\s+(von|out of|\u0645\u0646)\s+\d+.*$", "", n, flags=re.IGNORECASE)
        n = re.sub(r"\s+(neu|new|\u062c\u062f\u064a\u062f|\u062a\u0645\u062a \u0627\u0644\u0625\u0636\u0627\u0641\u0629).*$", "", n, flags=re.IGNORECASE)
        n = re.sub(r"\s+\d+[.,]\d+\s*(\u062c\u0646\u064a\u0647|\u0631\u064a\u0627\u0644|\u062f\u0631\u0647\u0645|EGP|SAR|AED|\$|\u20ac).*$", "", n, flags=re.IGNORECASE)
        n = re.sub(r"\s+(\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644|Sign in).*$", "", n, flags=re.IGNORECASE)
        return n.strip()[:300]
    return ""

def parse_image(html):
    m = re.search(r'src=["\']?(https?://[^"\'>\s]*images-amazon[^"\'>\s]*/images/I/[^"\'>\s]+)', html)
    return m.group(1) if m else ""

def format_price(price, currency):
    if price == "N/A": return "N/A"
    try:
        return f"{CURRENCY_SYMBOLS.get(currency, currency + ' ')}{float(price):,.2f}"
    except: return price

# ── HTTP Handler ──

class Handler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            asin = data.get("asin", "").strip().upper()
            region_key = data.get("region", "COM").strip().upper()
            api_key = data.get("crawleoApiKey", "")

            if not asin or not re.match(r"^[A-Z0-9]{10}$", asin):
                self._json({"error": "Valid ASIN required"}, 400); return
            if not api_key:
                self._json({"error": "API key required"}, 400); return

            r = REGIONS.get(region_key, REGIONS["COM"])
            url = f'https://www.{r["domain"]}/gp/product/ajax/aodAjaxMain/?asin={asin}'
            params = urllib.parse.urlencode({"urls": url, "render_js": "true", "raw_html": "true", "enhanced_html": "true", "markdown": "true", "geolocation": r["geo"]})
            api_url = f"{CRAWLEO_API}?{params}"

            print(f"[Crawleo] {asin} on {region_key}...", flush=True)
            req = urllib.request.Request(api_url, headers={"x-api-key": api_key})
            with urllib.request.urlopen(req, timeout=90) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            if result.get("results") and len(result["results"]) > 0:
                raw_html = result["results"][0].get("raw_html", "")
                print(f"[Crawleo] OK! {len(raw_html)} chars", flush=True)
                price, currency = parse_price(raw_html, r["currency"])
                name = parse_name(raw_html)
                image = parse_image(raw_html)
                self._json({"success": True, "asin": asin, "results": [{"domain": r["domain"], "region": region_key, "name": name, "image": image, "price": price, "currency": currency, "priceDisplay": format_price(price, currency), "asin": asin}]})
            else:
                self._json({"success": False, "error": "No results"}, 500)
        except Exception as e:
            print(f"[Error] {e}", flush=True)
            self._json({"error": str(e)}, 500)

    def _json(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, fmt, *args): pass  # suppress default logging

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 3002), Handler)
    print("🚀 Crawleo Python service on port 3002", flush=True)
    server.serve_forever()
