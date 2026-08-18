# AdHello Leads — Chrome Extension

Save **leads**, **real estate listings**, and **product listings** from **business websites**, social profiles, and directories directly into your AdHello pipeline.

## Supported sites

### Business websites (any company site)
- Open the business website → **Save lead** (floating button or extension popup)
- Scrapes **name, phone, email, address, city/state, website**, plus **Facebook / Instagram / X / LinkedIn / TikTok** when linked on the page (footer, contact blocks, JSON-LD `sameAs`)
- Junk emails (image filenames, theme-vendor inboxes, placeholders) are filtered out

### Social
- LinkedIn (profiles & companies)
- Facebook (pages & profiles)
- Instagram (profiles)

### Business directories
- Google Maps, Yelp, Yellow Pages, BBB, TripAdvisor
- Angi, HomeAdvisor, Thumbtack, Apple/Bing Maps
- Foursquare, Manta, Citysearch, Superpages
- Groupon, Nextdoor, Houzz

### Real estate listings
- **Zillow** — homes & property detail pages
- **MHVillage** — mobile / manufactured homes
- **Realtor.com** — property detail pages
- **Redfin** — home listings
- **Craigslist** — real estate & for-sale posts
- **Facebook Marketplace** — homes and land (auto-detected as real estate when applicable)

### Product / marketplace listings
- **Facebook Marketplace** — general items
- **OfferUp**
- **eBay**
- **Craigslist** — for-sale categories

Listings save with `jobType`, `sourceType`, and a `listing` object (price, beds, baths, sqft) — the same shape as Find → Real estate / Products search.

## Install (developer mode)

1. Download **adhello-leads-chrome-extension.zip** from **Workspace → Integrations** in AdHello (or clone this repo).
2. Unzip the file on your computer.
3. Chrome → **Extensions** → enable **Developer mode**
4. **Load unpacked** → select the unzipped `adhello-leads-chrome-extension/` folder (must contain `manifest.json` at the top level).
5. Open extension **Settings**:
   - **API base URL** — e.g. `https://adhelloleadsos.onrender.com`
   - **API key** — your `API_INGEST_KEY`
   - **Workspace ID** — usually `default`

Reload the extension after updates.

## How to use

1. Open a listing or profile on any supported site
2. Click **Save lead** (floating button) or the extension icon
3. Review auto-filled title, price, beds/baths/sqft, address, and notes
4. Save — the lead lands in the **Chrome Extension** folder in Pipeline (created automatically on first save), or in a **custom folder** if you set one in the popup or Settings.

To hide the floating yellow **Save lead** button, uncheck **Show Save lead button on pages** in Settings (or the popup). Save from the Chrome toolbar icon instead.

### Import a lead list (CSV)

1. Open extension **Settings** (right-click the extension icon → Options).
2. Under **Import a lead list**, enter a **folder name** (created automatically if new).
3. Choose a **CSV** file with columns like `company_name`, `phone`, `address`, `website`.
4. Click **Import list to AdHello** — all rows file into that folder in Pipeline.

Set **Default folder name** in Settings to pre-fill the popup and single-save folder field.

## Import modes — which sites use which

| Mode | Where it works | Best for |
|------|----------------|----------|
| **Bulk scrape** | **Google Maps** search results only (left results list) | Scraping a full local search without a separate tool |
| **Save lead** | One business at a time on Google Maps, **Yelp**, Yellow Pages, BBB, TripAdvisor, Angi, HomeAdvisor, Thumbtack, Apple/Bing Maps, Foursquare, Manta, Groupon, Nextdoor, Houzz, LinkedIn, Facebook, Instagram, Zillow, MHVillage, Realtor.com, Redfin, OfferUp, eBay, Craigslist, Facebook Marketplace | Saving while you browse |
| **Import CSV** | **Any source** — paste/upload a spreadsheet or export from Google Maps, Yelp, Outscraper, SmartScraper, Apollo, etc. | Lists you already exported elsewhere |

Yelp and other directories do **not** support in-browser bulk scrape yet — use **Save lead** per page or **Import CSV** from an export.

### Bulk scrape Google Maps search results

1. In Chrome, run a **Google Maps search** (e.g. “electricians in Gig Harbor”) so the **left results list** is visible.
2. Open the extension → **Bulk scrape** tab.
3. Enter a **folder name** (created automatically in Pipeline if new).
4. Leave **Scroll to load all results** checked to auto-scroll the list, or uncheck to scrape only what is already loaded.
5. Click **Scrape & import to AdHello** — while scrolling, the button becomes **Stop scrolling**.
6. Optional: leave **Fetch websites in parallel** checked — scrapes the full list first, then opens **5 hidden Maps tabs at once** for websites/domains (about 4–5× faster than one-by-one).
7. Uncheck that box for the fastest import (name, phone, address, reviews only) — use **Re-enrich folder** later for websites.

### Re-enrich an existing folder (no re-scroll)

Already imported a folder but **Website** / **Domain** / **City** / **State** are empty?

1. Open any Google Maps tab (the extension will visit each saved Maps URL).
2. Extension → **Bulk scrape** → enter the **same folder name** (e.g. `Flooring`).
3. Click **Re-enrich folder (websites & domains)**.
4. AdHello loads leads missing website or city/state, opens each Google Maps place page, scrapes the site + address, and patches only empty fields.

Run again if some listings had no website on Maps or the tab timed out.

No separate scraper extension required — this is built into AdHello Leads v1.7+.

### Scrape a business website

1. Open the company’s website in Chrome (home, contact, or about page works best).
2. Click **Save lead** on the page (or open the extension popup).
3. Review auto-filled phone, email, address, and social links.
4. Save — fields land on the lead in AdHello (Chrome Extension folder by default).

## API payload (listings)

```http
POST /autonomous/leads
x-api-key: <API_INGEST_KEY>
x-workspace-id: default

{
  "title": "3bd Mobile Home · $45,000",
  "address": "123 Park Ln, Austin, TX",
  "city": "Austin",
  "state": "TX",
  "url": "https://www.mhvillage.com/...",
  "jobType": "real_estate",
  "sourceType": "real_estate",
  "source": "chrome_extension",
  "sourceChannel": "mhvillage",
  "listing": {
    "source": "mhvillage",
    "price": 45000,
    "beds": 3,
    "baths": 2,
    "sqft": 1200,
    "propertyType": "mobile_home"
  }
}
```

## Notes

- Zillow, MHVillage, and other sites change their HTML often — edit fields before saving if needed.
- Wait for listing pages to fully load before clicking Save.
- Facebook Marketplace auto-classifies as real estate when the title/description mentions homes, land, or mobile homes.
