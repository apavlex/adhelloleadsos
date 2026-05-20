// Prospecting expansion tracker
// Phase 1 (current): Vancouver WA, Portland OR, Seattle WA
// Phase 2 (after 2 weeks): Add Boise ID, Spokane WA
// Phase 3 (after 4 weeks): Add Denver CO, Salt Lake City UT
// Phase 4 (after 6 weeks): Add Phoenix AZ, Las Vegas NV
// Phase 5 (after 8 weeks): Add Dallas TX, Houston TX
// Phase 6 (after 10 weeks): Add Chicago IL, Detroit MI
// Phase 7 (after 12 weeks): Add Atlanta GA, Charlotte NC
// Phase 8 (after 14 weeks): Add New York NY, Boston MA

const PROSPECTING_PHASES = {
  1: {
    name: "Pacific Northwest Launch",
    cities: [
      { city: "Vancouver", state: "WA" },
      { city: "Portland", state: "OR" },
      { city: "Seattle", state: "WA" },
    ],
    started: "2026-05-20",
  },
  2: {
    name: "Inland Northwest Expansion",
    cities: [
      { city: "Vancouver", state: "WA" },
      { city: "Portland", state: "OR" },
      { city: "Seattle", state: "WA" },
      { city: "Boise", state: "ID" },
      { city: "Spokane", state: "WA" },
    ],
    targetStart: "2026-06-03",
  },
  3: {
    name: "Mountain West",
    cities: [
      { city: "Vancouver", state: "WA" },
      { city: "Portland", state: "OR" },
      { city: "Seattle", state: "WA" },
      { city: "Boise", state: "ID" },
      { city: "Spokane", state: "WA" },
      { city: "Denver", state: "CO" },
      { city: "Salt Lake City", state: "UT" },
    ],
    targetStart: "2026-06-17",
  },
  4: {
    name: "Southwest",
    cities: [
      { city: "Denver", state: "CO" },
      { city: "Salt Lake City", state: "UT" },
      { city: "Phoenix", state: "AZ" },
      { city: "Las Vegas", state: "NV" },
    ],
    targetStart: "2026-07-01",
  },
  5: {
    name: "Texas",
    cities: [
      { city: "Phoenix", state: "AZ" },
      { city: "Las Vegas", state: "NV" },
      { city: "Dallas", state: "TX" },
      { city: "Houston", state: "TX" },
    ],
    targetStart: "2026-07-15",
  },
  6: {
    name: "Midwest",
    cities: [
      { city: "Dallas", state: "TX" },
      { city: "Houston", state: "TX" },
      { city: "Chicago", state: "IL" },
      { city: "Detroit", state: "MI" },
    ],
    targetStart: "2026-07-29",
  },
  7: {
    name: "Southeast",
    cities: [
      { city: "Chicago", state: "IL" },
      { city: "Detroit", state: "MI" },
      { city: "Atlanta", state: "GA" },
      { city: "Charlotte", state: "NC" },
    ],
    targetStart: "2026-08-12",
  },
  8: {
    name: "Northeast",
    cities: [
      { city: "Atlanta", state: "GA" },
      { city: "Charlotte", state: "NC" },
      { city: "New York", state: "NY" },
      { city: "Boston", state: "MA" },
    ],
    targetStart: "2026-08-26",
  },
};

// Categories to search in each city
const CATEGORIES = [
  "plumber",
  "HVAC contractor",
  "landscaping",
  "house cleaning",
];

module.exports = { PROSPECTING_PHASES, CATEGORIES };
