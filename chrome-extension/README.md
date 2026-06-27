# AdHello Leads — Chrome Extension

Save **leads**, **real estate listings**, and **product listings** from social profiles and directories directly into your AdHello pipeline.

## Supported sites

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

1. Chrome → **Extensions** → enable **Developer mode**
2. **Load unpacked** → select `chrome-extension/`
3. Open extension **Settings**:
   - **API base URL** — e.g. `https://adhelloleadsos.onrender.com`
   - **API key** — your `API_INGEST_KEY`
   - **Workspace ID** — usually `default`

Reload the extension after updates.

## How to use

1. Open a listing or profile on any supported site
2. Click **Save lead** (floating button) or the extension icon
3. Review auto-filled title, price, beds/baths/sqft, address, and notes
4. Save — the lead lands in the **Chrome Extension** folder in Pipeline (created automatically on first save), or in a **custom folder** if you set one in the popup or Settings.

### Import a lead list (CSV)

1. Open extension **Settings** (right-click the extension icon → Options).
2. Under **Import a lead list**, enter a **folder name** (created automatically if new).
3. Choose a **CSV** file with columns like `company_name`, `phone`, `address`, `website`.
4. Click **Import list to AdHello** — all rows file into that folder in Pipeline.

Set **Default folder name** in Settings to pre-fill the popup and single-save folder field.

### Bulk scrape Google Maps search results

1. In Chrome, run a **Google Maps search** (e.g. “electricians in Gig Harbor”) so the **left results list** is visible.
2. Open the extension → **Bulk scrape** tab.
3. Enter a **folder name** (created automatically in Pipeline if new).
4. Leave **Scroll to load all results** checked to auto-scroll the list, or uncheck to scrape only what is already loaded.
5. Click **Scrape & import to AdHello** — while scrolling, the button becomes **Stop scrolling**.
6. Leave **Open each listing to fetch website & domain** checked (recommended) — this opens each Maps result briefly to capture the business website and domain. Uncheck for a faster import with phone/address/reviews only.
7. Leads import into your folder with name, phone, full address, city, state, category, rating, reviews, review snippet, website, domain, and Maps URL. Duplicates merge with existing leads.

No separate scraper extension required — this is built into AdHello Leads v1.5+.

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
