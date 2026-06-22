# AdHello Lead Saver — Chrome Extension

Save prospects from **social profiles** and **business directories** directly into your AdHello lead database while you browse.

## Supported sites

### Social
- LinkedIn (profiles & companies)
- Facebook (pages & profiles)
- Instagram (profiles)

### Business directories
- **Google Maps** — business listings
- **Yelp** — `/biz/` pages
- **Yellow Pages**
- **BBB** (Better Business Bureau)
- **TripAdvisor** (restaurants, hotels, attractions)
- **Angi** & **HomeAdvisor**
- **Thumbtack**
- **Apple Maps** & **Bing Maps**
- **Foursquare**, **Manta**, **Citysearch**, **Superpages**
- **Groupon** — deals & merchant pages
- **Craigslist** — services & business listings
- **Nextdoor** — local business pages
- **Houzz** — pro profiles

## Install (developer mode)

1. Open Chrome → **Extensions** → enable **Developer mode**
2. Click **Load unpacked**
3. Select this folder: `chrome-extension/`
4. Open extension **Settings** and enter:
   - **API base URL** — e.g. `https://adhelloleadsos.onrender.com` or `http://localhost:3000`
   - **API key** — your server `API_INGEST_KEY`
   - **Workspace ID** — usually `default`

After updating the extension, click **Reload** on the Extensions page.

## How to use

1. Visit a profile or business listing on any supported site
2. Click the floating **Save lead** button (bottom-right), or click the extension icon
3. Review auto-filled fields (name, phone, address, website, rating)
4. Edit anything that looks off, then save

Leads are stored via `POST /autonomous/leads` with `source: chrome_extension`.

## What gets captured

| Source | Auto-filled fields |
|--------|-------------------|
| LinkedIn | Name, headline, profile URL |
| Facebook / Instagram | Name, bio, profile URL |
| Google Maps / Yelp / directories | Business name, phone, address, city/state, website, rating, review count, listing URL |
| Groupon | Merchant name, deal title, address, category |
| Craigslist | Posting title, location, phone/website from ad body |
| Nextdoor | Business name, address, category |
| Houzz | Pro name, specialty, location, rating |

Directory extractors use **JSON-LD** (schema.org LocalBusiness) when available, plus DOM fallbacks for phone, website, and address.

## API reference

```http
POST /autonomous/leads
x-api-key: <API_INGEST_KEY>
x-workspace-id: default
Content-Type: application/json

{
  "title": "Joe's Plumbing",
  "phone": "(512) 555-0100",
  "website": "https://joesplumbing.com",
  "address": "123 Main St, Austin, TX 78701",
  "city": "Austin",
  "state": "TX",
  "totalScore": 4.6,
  "reviewsCount": 128,
  "url": "https://google.com/maps/place/...",
  "source": "chrome_extension",
  "sourceChannel": "google_maps"
}
```

## Notes

- Directory sites change their HTML often. If a field is wrong, edit it before saving.
- Google Maps in particular is heavily dynamic — wait for the side panel to fully load before clicking Save.
- Respect each platform's terms of service for personal use and outreach compliance.
