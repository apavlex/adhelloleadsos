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
4. Save — the lead lands in the correct pipeline folder (Real estate or Products)

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
