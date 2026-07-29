/** Supported Permit Stack search cities (synced from permit-stack.com/search.html). */
/** Run: node scripts/syncPermitStackCities.js */

const PERMIT_STACK_CITIES = [
  {
    "city": "Bessemer Building and Inspections",
    "label": "Bessemer Building and Inspections",
    "state": "AL"
  },
  {
    "city": "Birmingham",
    "label": "Birmingham",
    "state": "AL"
  },
  {
    "city": "Calera",
    "label": "Calera",
    "state": "AL"
  },
  {
    "city": "Daphne",
    "label": "Daphne",
    "state": "AL"
  },
  {
    "city": "Foley",
    "label": "Foley",
    "state": "AL"
  },
  {
    "city": "Huntsville",
    "label": "Huntsville",
    "state": "AL"
  },
  {
    "city": "Mobile",
    "label": "Mobile",
    "state": "AL"
  },
  {
    "city": "Pelham",
    "label": "Pelham",
    "state": "AL"
  },
  {
    "city": "Prattville",
    "label": "Prattville",
    "state": "AL"
  },
  {
    "city": "Robertsdale",
    "label": "Robertsdale",
    "state": "AL"
  },
  {
    "city": "Arkansas (LBNL Tracking the Sun)",
    "label": "Arkansas (LBNL Tracking the Sun)",
    "state": "AR"
  },
  {
    "city": "Conway",
    "label": "Conway",
    "state": "AR"
  },
  {
    "city": "Russellville",
    "label": "Russellville",
    "state": "AR"
  },
  {
    "city": "Arizona (LBNL Tracking the Sun)",
    "label": "Arizona (LBNL Tracking the Sun)",
    "state": "AZ"
  },
  {
    "city": "Bisbee",
    "label": "Bisbee",
    "state": "AZ"
  },
  {
    "city": "Camp Verde",
    "label": "Camp Verde",
    "state": "AZ"
  },
  {
    "city": "Chandler",
    "label": "Chandler",
    "state": "AZ"
  },
  {
    "city": "Coconino County",
    "label": "Coconino County",
    "state": "AZ"
  },
  {
    "city": "Gilbert",
    "label": "Gilbert",
    "state": "AZ"
  },
  {
    "city": "Maricopa County",
    "label": "Maricopa County",
    "state": "AZ"
  },
  {
    "city": "Mesa",
    "label": "Mesa",
    "state": "AZ"
  },
  {
    "city": "Navajo County",
    "label": "Navajo County",
    "state": "AZ"
  },
  {
    "city": "Peoria",
    "label": "Peoria",
    "state": "AZ"
  },
  {
    "city": "Queen Creek",
    "label": "Queen Creek",
    "state": "AZ"
  },
  {
    "city": "Scottsdale",
    "label": "Scottsdale",
    "state": "AZ"
  },
  {
    "city": "Tempe",
    "label": "Tempe",
    "state": "AZ"
  },
  {
    "city": "Tucson",
    "label": "Tucson",
    "state": "AZ"
  },
  {
    "city": "Yuma",
    "label": "Yuma",
    "state": "AZ"
  },
  {
    "city": "Alisoviejo",
    "label": "Alisoviejo",
    "state": "CA"
  },
  {
    "city": "Amador County",
    "label": "Amador County",
    "state": "CA"
  },
  {
    "city": "Anaheim",
    "label": "Anaheim",
    "state": "CA"
  },
  {
    "city": "Antioch",
    "label": "Antioch",
    "state": "CA"
  },
  {
    "city": "Arcadia",
    "label": "Arcadia",
    "state": "CA"
  },
  {
    "city": "Auburn Community Development",
    "label": "Auburn Community Development",
    "state": "CA"
  },
  {
    "city": "Baldwin Park",
    "label": "Baldwin Park",
    "state": "CA"
  },
  {
    "city": "Beaumont",
    "label": "Beaumont",
    "state": "CA"
  },
  {
    "city": "California (LBNL Tracking the Sun)",
    "label": "California (LBNL Tracking the Sun)",
    "state": "CA"
  },
  {
    "city": "California (Statewide Solar)",
    "label": "California (Statewide Solar)",
    "state": "CA"
  },
  {
    "city": "Camarillo",
    "label": "Camarillo",
    "state": "CA"
  },
  {
    "city": "Carpinteria",
    "label": "Carpinteria",
    "state": "CA"
  },
  {
    "city": "Carson",
    "label": "Carson",
    "state": "CA"
  },
  {
    "city": "Coalinga",
    "label": "Coalinga",
    "state": "CA"
  },
  {
    "city": "Corona",
    "label": "Corona",
    "state": "CA"
  },
  {
    "city": "Cotati",
    "label": "Cotati",
    "state": "CA"
  },
  {
    "city": "Daly City",
    "label": "Daly City",
    "state": "CA"
  },
  {
    "city": "Danville",
    "label": "Danville",
    "state": "CA"
  },
  {
    "city": "Dixon",
    "label": "Dixon",
    "state": "CA"
  },
  {
    "city": "Dublin",
    "label": "Dublin",
    "state": "CA"
  },
  {
    "city": "El Cajon",
    "label": "El Cajon",
    "state": "CA"
  },
  {
    "city": "El Monte",
    "label": "El Monte",
    "state": "CA"
  },
  {
    "city": "Elk Grove",
    "label": "Elk Grove",
    "state": "CA"
  },
  {
    "city": "Fairfield",
    "label": "Fairfield",
    "state": "CA"
  },
  {
    "city": "Gilroy",
    "label": "Gilroy",
    "state": "CA"
  },
  {
    "city": "Glendale",
    "label": "Glendale",
    "state": "CA"
  },
  {
    "city": "Glendora",
    "label": "Glendora",
    "state": "CA"
  },
  {
    "city": "Grover Beach",
    "label": "Grover Beach",
    "state": "CA"
  },
  {
    "city": "Half Moon Bay",
    "label": "Half Moon Bay",
    "state": "CA"
  },
  {
    "city": "Hawthorne",
    "label": "Hawthorne",
    "state": "CA"
  },
  {
    "city": "Hayward",
    "label": "Hayward",
    "state": "CA"
  },
  {
    "city": "Healdsburg",
    "label": "Healdsburg",
    "state": "CA"
  },
  {
    "city": "Imperial Beach",
    "label": "Imperial Beach",
    "state": "CA"
  },
  {
    "city": "Imperial County",
    "label": "Imperial County",
    "state": "CA"
  },
  {
    "city": "Indian Wells",
    "label": "Indian Wells",
    "state": "CA"
  },
  {
    "city": "Indio",
    "label": "Indio",
    "state": "CA"
  },
  {
    "city": "Kern County",
    "label": "Kern County",
    "state": "CA"
  },
  {
    "city": "La Canada Flintridge",
    "label": "La Canada Flintridge",
    "state": "CA"
  },
  {
    "city": "La Habra Online",
    "label": "La Habra Online",
    "state": "CA"
  },
  {
    "city": "La Quinta",
    "label": "La Quinta",
    "state": "CA"
  },
  {
    "city": "Laguna Beach",
    "label": "Laguna Beach",
    "state": "CA"
  },
  {
    "city": "Laguna Niguel",
    "label": "Laguna Niguel",
    "state": "CA"
  },
  {
    "city": "Lagunahills",
    "label": "Lagunahills",
    "state": "CA"
  },
  {
    "city": "Lake Forest",
    "label": "Lake Forest",
    "state": "CA"
  },
  {
    "city": "Lathrop",
    "label": "Lathrop",
    "state": "CA"
  },
  {
    "city": "LemooreCA",
    "label": "LemooreCA",
    "state": "CA"
  },
  {
    "city": "Lomalinda",
    "label": "Lomalinda",
    "state": "CA"
  },
  {
    "city": "Los Angeles",
    "label": "Los Angeles",
    "state": "CA"
  },
  {
    "city": "Los Angeles County",
    "label": "Los Angeles County",
    "state": "CA"
  },
  {
    "city": "Manhattan Beach",
    "label": "Manhattan Beach",
    "state": "CA"
  },
  {
    "city": "Marin County",
    "label": "Marin County",
    "state": "CA"
  },
  {
    "city": "Mariposa County",
    "label": "Mariposa County",
    "state": "CA"
  },
  {
    "city": "Merced",
    "label": "Merced",
    "state": "CA"
  },
  {
    "city": "Murrieta",
    "label": "Murrieta",
    "state": "CA"
  },
  {
    "city": "Oakland",
    "label": "Oakland",
    "state": "CA"
  },
  {
    "city": "Oroville",
    "label": "Oroville",
    "state": "CA"
  },
  {
    "city": "Oxnard",
    "label": "Oxnard",
    "state": "CA"
  },
  {
    "city": "Palm Springs",
    "label": "Palm Springs",
    "state": "CA"
  },
  {
    "city": "Paradise",
    "label": "Paradise",
    "state": "CA"
  },
  {
    "city": "Pasadena (CA)",
    "label": "Pasadena (CA)",
    "state": "CA"
  },
  {
    "city": "Petaluma",
    "label": "Petaluma",
    "state": "CA"
  },
  {
    "city": "Placer County",
    "label": "Placer County",
    "state": "CA"
  },
  {
    "city": "Pomona",
    "label": "Pomona",
    "state": "CA"
  },
  {
    "city": "Porterville",
    "label": "Porterville",
    "state": "CA"
  },
  {
    "city": "Portolavalley",
    "label": "Portolavalley",
    "state": "CA"
  },
  {
    "city": "Poway Online Services",
    "label": "Poway Online Services",
    "state": "CA"
  },
  {
    "city": "Rancho Mirage",
    "label": "Rancho Mirage",
    "state": "CA"
  },
  {
    "city": "Ranchocordova",
    "label": "Ranchocordova",
    "state": "CA"
  },
  {
    "city": "Redding",
    "label": "Redding",
    "state": "CA"
  },
  {
    "city": "Rialto",
    "label": "Rialto",
    "state": "CA"
  },
  {
    "city": "Riverside County",
    "label": "Riverside County",
    "state": "CA"
  },
  {
    "city": "Roseville",
    "label": "Roseville",
    "state": "CA"
  },
  {
    "city": "Sacramento",
    "label": "Sacramento",
    "state": "CA"
  },
  {
    "city": "Sacramento Archive",
    "label": "Sacramento Archive",
    "state": "CA"
  },
  {
    "city": "San Carlos",
    "label": "San Carlos",
    "state": "CA"
  },
  {
    "city": "San Diego",
    "label": "San Diego",
    "state": "CA"
  },
  {
    "city": "San Diego County",
    "label": "San Diego County",
    "state": "CA"
  },
  {
    "city": "San Francisco",
    "label": "San Francisco",
    "state": "CA"
  },
  {
    "city": "San Jacinto",
    "label": "San Jacinto",
    "state": "CA"
  },
  {
    "city": "San Jose",
    "label": "San Jose",
    "state": "CA"
  },
  {
    "city": "San Luis Obispo County",
    "label": "San Luis Obispo County",
    "state": "CA"
  },
  {
    "city": "San Mateo",
    "label": "San Mateo",
    "state": "CA"
  },
  {
    "city": "Santa Rosa",
    "label": "Santa Rosa",
    "state": "CA"
  },
  {
    "city": "Santee",
    "label": "Santee",
    "state": "CA"
  },
  {
    "city": "Sonoma County (Construction)",
    "label": "Sonoma County (Construction)",
    "state": "CA"
  },
  {
    "city": "Sonoma County (Planning)",
    "label": "Sonoma County (Planning)",
    "state": "CA"
  },
  {
    "city": "Sonoma County (Rebuilding)",
    "label": "Sonoma County (Rebuilding)",
    "state": "CA"
  },
  {
    "city": "Stockton",
    "label": "Stockton",
    "state": "CA"
  },
  {
    "city": "Suisun City",
    "label": "Suisun City",
    "state": "CA"
  },
  {
    "city": "Sunnyvale",
    "label": "Sunnyvale",
    "state": "CA"
  },
  {
    "city": "Thousand Oaks",
    "label": "Thousand Oaks",
    "state": "CA"
  },
  {
    "city": "Tustin",
    "label": "Tustin",
    "state": "CA"
  },
  {
    "city": "Upland - Development Services",
    "label": "Upland - Development Services",
    "state": "CA"
  },
  {
    "city": "Ventura",
    "label": "Ventura",
    "state": "CA"
  },
  {
    "city": "Ventura (Active)",
    "label": "Ventura (Active)",
    "state": "CA"
  },
  {
    "city": "Victorville",
    "label": "Victorville",
    "state": "CA"
  },
  {
    "city": "West Sacramento",
    "label": "West Sacramento",
    "state": "CA"
  },
  {
    "city": "Winters",
    "label": "Winters",
    "state": "CA"
  },
  {
    "city": "Yuba County",
    "label": "Yuba County",
    "state": "CA"
  },
  {
    "city": "Yucaipa",
    "label": "Yucaipa",
    "state": "CA"
  },
  {
    "city": "Boulder",
    "label": "Boulder",
    "state": "CO"
  },
  {
    "city": "Boulder County",
    "label": "Boulder County",
    "state": "CO"
  },
  {
    "city": "Breckenridge",
    "label": "Breckenridge",
    "state": "CO"
  },
  {
    "city": "Centennial",
    "label": "Centennial",
    "state": "CO"
  },
  {
    "city": "Colorado (LBNL Tracking the Sun)",
    "label": "Colorado (LBNL Tracking the Sun)",
    "state": "CO"
  },
  {
    "city": "Colorado Springs",
    "label": "Colorado Springs",
    "state": "CO"
  },
  {
    "city": "Denver Commercial",
    "label": "Denver Commercial",
    "state": "CO"
  },
  {
    "city": "Denver Residential",
    "label": "Denver Residential",
    "state": "CO"
  },
  {
    "city": "Erie",
    "label": "Erie",
    "state": "CO"
  },
  {
    "city": "Fort Collins",
    "label": "Fort Collins",
    "state": "CO"
  },
  {
    "city": "Fruita",
    "label": "Fruita",
    "state": "CO"
  },
  {
    "city": "Grand Junction",
    "label": "Grand Junction",
    "state": "CO"
  },
  {
    "city": "Larimer County",
    "label": "Larimer County",
    "state": "CO"
  },
  {
    "city": "Parker",
    "label": "Parker",
    "state": "CO"
  },
  {
    "city": "Connecticut (Energy Storage Solutions)",
    "label": "Connecticut (Energy Storage Solutions)",
    "state": "CT"
  },
  {
    "city": "Connecticut (RSIP Solar)",
    "label": "Connecticut (RSIP Solar)",
    "state": "CT"
  },
  {
    "city": "East Granby",
    "label": "East Granby",
    "state": "CT"
  },
  {
    "city": "Easton",
    "label": "Easton",
    "state": "CT"
  },
  {
    "city": "Guilford",
    "label": "Guilford",
    "state": "CT"
  },
  {
    "city": "Hartford",
    "label": "Hartford",
    "state": "CT"
  },
  {
    "city": "Middlebury",
    "label": "Middlebury",
    "state": "CT"
  },
  {
    "city": "District of Columbia (LBNL Tracking the Sun)",
    "label": "District of Columbia (LBNL Tracking the Sun)",
    "state": "DC"
  },
  {
    "city": "Washington DC",
    "label": "Washington DC",
    "state": "DC"
  },
  {
    "city": "Delaware (LBNL Tracking the Sun)",
    "label": "Delaware (LBNL Tracking the Sun)",
    "state": "DE"
  },
  {
    "city": "Milford",
    "label": "Milford",
    "state": "DE"
  },
  {
    "city": "Newark",
    "label": "Newark",
    "state": "DE"
  },
  {
    "city": "Alachua County",
    "label": "Alachua County",
    "state": "FL"
  },
  {
    "city": "Auburndale",
    "label": "Auburndale",
    "state": "FL"
  },
  {
    "city": "Bartow",
    "label": "Bartow",
    "state": "FL"
  },
  {
    "city": "Belleair",
    "label": "Belleair",
    "state": "FL"
  },
  {
    "city": "Belleair Beach",
    "label": "Belleair Beach",
    "state": "FL"
  },
  {
    "city": "Belleair Bluffs",
    "label": "Belleair Bluffs",
    "state": "FL"
  },
  {
    "city": "Boca eHub",
    "label": "Boca eHub",
    "state": "FL"
  },
  {
    "city": "Brevard County",
    "label": "Brevard County",
    "state": "FL"
  },
  {
    "city": "Cape Coral",
    "label": "Cape Coral",
    "state": "FL"
  },
  {
    "city": "Charlotte County",
    "label": "Charlotte County",
    "state": "FL"
  },
  {
    "city": "Citrus County",
    "label": "Citrus County",
    "state": "FL"
  },
  {
    "city": "Clay County",
    "label": "Clay County",
    "state": "FL"
  },
  {
    "city": "Clearwater",
    "label": "Clearwater",
    "state": "FL"
  },
  {
    "city": "Clewiston",
    "label": "Clewiston",
    "state": "FL"
  },
  {
    "city": "Davenport",
    "label": "Davenport",
    "state": "FL"
  },
  {
    "city": "Daytona Beach",
    "label": "Daytona Beach",
    "state": "FL"
  },
  {
    "city": "DeLand",
    "label": "DeLand",
    "state": "FL"
  },
  {
    "city": "Delray Beach",
    "label": "Delray Beach",
    "state": "FL"
  },
  {
    "city": "Deltona",
    "label": "Deltona",
    "state": "FL"
  },
  {
    "city": "DeSoto County",
    "label": "DeSoto County",
    "state": "FL"
  },
  {
    "city": "Destin",
    "label": "Destin",
    "state": "FL"
  },
  {
    "city": "Doral",
    "label": "Doral",
    "state": "FL"
  },
  {
    "city": "Dundee",
    "label": "Dundee",
    "state": "FL"
  },
  {
    "city": "Dunedin",
    "label": "Dunedin",
    "state": "FL"
  },
  {
    "city": "Eagle Lake",
    "label": "Eagle Lake",
    "state": "FL"
  },
  {
    "city": "Eustis",
    "label": "Eustis",
    "state": "FL"
  },
  {
    "city": "Florida (LBNL Tracking the Sun)",
    "label": "Florida (LBNL Tracking the Sun)",
    "state": "FL"
  },
  {
    "city": "Fort Lauderdale",
    "label": "Fort Lauderdale",
    "state": "FL"
  },
  {
    "city": "Fort Meade",
    "label": "Fort Meade",
    "state": "FL"
  },
  {
    "city": "Fort Myers",
    "label": "Fort Myers",
    "state": "FL"
  },
  {
    "city": "Fort Pierce",
    "label": "Fort Pierce",
    "state": "FL"
  },
  {
    "city": "Frostproof",
    "label": "Frostproof",
    "state": "FL"
  },
  {
    "city": "Gulfport",
    "label": "Gulfport",
    "state": "FL"
  },
  {
    "city": "Haines City",
    "label": "Haines City",
    "state": "FL"
  },
  {
    "city": "Hallandale Beach",
    "label": "Hallandale Beach",
    "state": "FL"
  },
  {
    "city": "Hernando County",
    "label": "Hernando County",
    "state": "FL"
  },
  {
    "city": "Hialeah",
    "label": "Hialeah",
    "state": "FL"
  },
  {
    "city": "Hillsborough County",
    "label": "Hillsborough County",
    "state": "FL"
  },
  {
    "city": "Hillsborough County (Historical)",
    "label": "Hillsborough County (Historical)",
    "state": "FL"
  },
  {
    "city": "Homestead",
    "label": "Homestead",
    "state": "FL"
  },
  {
    "city": "Indian Rocks Beach",
    "label": "Indian Rocks Beach",
    "state": "FL"
  },
  {
    "city": "Indian Shores",
    "label": "Indian Shores",
    "state": "FL"
  },
  {
    "city": "Jacksonville",
    "label": "Jacksonville",
    "state": "FL"
  },
  {
    "city": "Jacksonville Beach",
    "label": "Jacksonville Beach",
    "state": "FL"
  },
  {
    "city": "Kenneth City",
    "label": "Kenneth City",
    "state": "FL"
  },
  {
    "city": "Kissimmee",
    "label": "Kissimmee",
    "state": "FL"
  },
  {
    "city": "Lake Alfred",
    "label": "Lake Alfred",
    "state": "FL"
  },
  {
    "city": "Lake Hamilton",
    "label": "Lake Hamilton",
    "state": "FL"
  },
  {
    "city": "Lake Mary",
    "label": "Lake Mary",
    "state": "FL"
  },
  {
    "city": "Lake Wales",
    "label": "Lake Wales",
    "state": "FL"
  },
  {
    "city": "Lake Worth Beach",
    "label": "Lake Worth Beach",
    "state": "FL"
  },
  {
    "city": "Lakeland",
    "label": "Lakeland",
    "state": "FL"
  },
  {
    "city": "Largo",
    "label": "Largo",
    "state": "FL"
  },
  {
    "city": "Madeira Beach",
    "label": "Madeira Beach",
    "state": "FL"
  },
  {
    "city": "Manatee County",
    "label": "Manatee County",
    "state": "FL"
  },
  {
    "city": "Marco Island",
    "label": "Marco Island",
    "state": "FL"
  },
  {
    "city": "Margate",
    "label": "Margate",
    "state": "FL"
  },
  {
    "city": "Martin County",
    "label": "Martin County",
    "state": "FL"
  },
  {
    "city": "Miami",
    "label": "Miami",
    "state": "FL"
  },
  {
    "city": "Miami Beach",
    "label": "Miami Beach",
    "state": "FL"
  },
  {
    "city": "Miami Gardens",
    "label": "Miami Gardens",
    "state": "FL"
  },
  {
    "city": "Miami-Dade County",
    "label": "Miami-Dade County",
    "state": "FL"
  },
  {
    "city": "Miramar",
    "label": "Miramar",
    "state": "FL"
  },
  {
    "city": "Mulberry",
    "label": "Mulberry",
    "state": "FL"
  },
  {
    "city": "New Smyrna Beach",
    "label": "New Smyrna Beach",
    "state": "FL"
  },
  {
    "city": "North Redington Beach",
    "label": "North Redington Beach",
    "state": "FL"
  },
  {
    "city": "Ocoee",
    "label": "Ocoee",
    "state": "FL"
  },
  {
    "city": "Okaloosa County",
    "label": "Okaloosa County",
    "state": "FL"
  },
  {
    "city": "Okeechobee County",
    "label": "Okeechobee County",
    "state": "FL"
  },
  {
    "city": "Oldsmar",
    "label": "Oldsmar",
    "state": "FL"
  },
  {
    "city": "Orange City",
    "label": "Orange City",
    "state": "FL"
  },
  {
    "city": "Orlando",
    "label": "Orlando",
    "state": "FL"
  },
  {
    "city": "Ormond Beach",
    "label": "Ormond Beach",
    "state": "FL"
  },
  {
    "city": "Osceola County",
    "label": "Osceola County",
    "state": "FL"
  },
  {
    "city": "Oviedo",
    "label": "Oviedo",
    "state": "FL"
  },
  {
    "city": "Palm Bay",
    "label": "Palm Bay",
    "state": "FL"
  },
  {
    "city": "Palm Beach",
    "label": "Palm Beach",
    "state": "FL"
  },
  {
    "city": "Palm Beach Gardens",
    "label": "Palm Beach Gardens",
    "state": "FL"
  },
  {
    "city": "Panama City",
    "label": "Panama City",
    "state": "FL"
  },
  {
    "city": "Pasco County",
    "label": "Pasco County",
    "state": "FL"
  },
  {
    "city": "Pasco County (Historical)",
    "label": "Pasco County (Historical)",
    "state": "FL"
  },
  {
    "city": "Pembroke Pines",
    "label": "Pembroke Pines",
    "state": "FL"
  },
  {
    "city": "Pensacola",
    "label": "Pensacola",
    "state": "FL"
  },
  {
    "city": "Pinellas County",
    "label": "Pinellas County",
    "state": "FL"
  },
  {
    "city": "Pinellas Park",
    "label": "Pinellas Park",
    "state": "FL"
  },
  {
    "city": "Polk City",
    "label": "Polk City",
    "state": "FL"
  },
  {
    "city": "Pompano Beach",
    "label": "Pompano Beach",
    "state": "FL"
  },
  {
    "city": "Port St. Lucie",
    "label": "Port St. Lucie",
    "state": "FL"
  },
  {
    "city": "Redington Beach",
    "label": "Redington Beach",
    "state": "FL"
  },
  {
    "city": "Redington Shores",
    "label": "Redington Shores",
    "state": "FL"
  },
  {
    "city": "Riviera Beach",
    "label": "Riviera Beach",
    "state": "FL"
  },
  {
    "city": "Royal Palm Beach",
    "label": "Royal Palm Beach",
    "state": "FL"
  },
  {
    "city": "Safety Harbor",
    "label": "Safety Harbor",
    "state": "FL"
  },
  {
    "city": "Sanibel",
    "label": "Sanibel",
    "state": "FL"
  },
  {
    "city": "Seminole",
    "label": "Seminole",
    "state": "FL"
  },
  {
    "city": "Seminole County",
    "label": "Seminole County",
    "state": "FL"
  },
  {
    "city": "South Pasadena",
    "label": "South Pasadena",
    "state": "FL"
  },
  {
    "city": "St. Pete Beach",
    "label": "St. Pete Beach",
    "state": "FL"
  },
  {
    "city": "St. Petersburg",
    "label": "St. Petersburg",
    "state": "FL"
  },
  {
    "city": "Sunrise",
    "label": "Sunrise",
    "state": "FL"
  },
  {
    "city": "Tallahassee",
    "label": "Tallahassee",
    "state": "FL"
  },
  {
    "city": "Tampa",
    "label": "Tampa",
    "state": "FL"
  },
  {
    "city": "Tarpon Springs",
    "label": "Tarpon Springs",
    "state": "FL"
  },
  {
    "city": "Tavares",
    "label": "Tavares",
    "state": "FL"
  },
  {
    "city": "Toho Water Authority",
    "label": "Toho Water Authority",
    "state": "FL"
  },
  {
    "city": "Treasure Island",
    "label": "Treasure Island",
    "state": "FL"
  },
  {
    "city": "Volusia County",
    "label": "Volusia County",
    "state": "FL"
  },
  {
    "city": "Walton County",
    "label": "Walton County",
    "state": "FL"
  },
  {
    "city": "Wellington",
    "label": "Wellington",
    "state": "FL"
  },
  {
    "city": "West Palm Beach",
    "label": "West Palm Beach",
    "state": "FL"
  },
  {
    "city": "Winter Haven",
    "label": "Winter Haven",
    "state": "FL"
  },
  {
    "city": "Winter Park",
    "label": "Winter Park",
    "state": "FL"
  },
  {
    "city": "Winter Springs",
    "label": "Winter Springs",
    "state": "FL"
  },
  {
    "city": "Zephyrhills",
    "label": "Zephyrhills",
    "state": "FL"
  },
  {
    "city": "Atlanta",
    "label": "Atlanta",
    "state": "GA"
  },
  {
    "city": "Barrow County",
    "label": "Barrow County",
    "state": "GA"
  },
  {
    "city": "Camden County",
    "label": "Camden County",
    "state": "GA"
  },
  {
    "city": "Clayton County",
    "label": "Clayton County",
    "state": "GA"
  },
  {
    "city": "Coweta County",
    "label": "Coweta County",
    "state": "GA"
  },
  {
    "city": "DeKalb County",
    "label": "DeKalb County",
    "state": "GA"
  },
  {
    "city": "Flowery Branch",
    "label": "Flowery Branch",
    "state": "GA"
  },
  {
    "city": "Forsyth County",
    "label": "Forsyth County",
    "state": "GA"
  },
  {
    "city": "Houston County",
    "label": "Houston County",
    "state": "GA"
  },
  {
    "city": "Johns Creek",
    "label": "Johns Creek",
    "state": "GA"
  },
  {
    "city": "Macon-Bibb County",
    "label": "Macon-Bibb County",
    "state": "GA"
  },
  {
    "city": "Perry",
    "label": "Perry",
    "state": "GA"
  },
  {
    "city": "Rincon",
    "label": "Rincon",
    "state": "GA"
  },
  {
    "city": "Roswell",
    "label": "Roswell",
    "state": "GA"
  },
  {
    "city": "Savannah",
    "label": "Savannah",
    "state": "GA"
  },
  {
    "city": "Westpoint",
    "label": "Westpoint",
    "state": "GA"
  },
  {
    "city": "Hawaii County",
    "label": "Hawaii County",
    "state": "HI"
  },
  {
    "city": "Honolulu",
    "label": "Honolulu",
    "state": "HI"
  },
  {
    "city": "Kauai County",
    "label": "Kauai County",
    "state": "HI"
  },
  {
    "city": "Cedar Rapids",
    "label": "Cedar Rapids",
    "state": "IA"
  },
  {
    "city": "Des Moines",
    "label": "Des Moines",
    "state": "IA"
  },
  {
    "city": "Pella",
    "label": "Pella",
    "state": "IA"
  },
  {
    "city": "West Des Moines",
    "label": "West Des Moines",
    "state": "IA"
  },
  {
    "city": "Boise",
    "label": "Boise",
    "state": "ID"
  },
  {
    "city": "Bonner County",
    "label": "Bonner County",
    "state": "ID"
  },
  {
    "city": "Nampa",
    "label": "Nampa",
    "state": "ID"
  },
  {
    "city": "Chicago",
    "label": "Chicago",
    "state": "IL"
  },
  {
    "city": "Chicago (ADU Preapproval)",
    "label": "Chicago (ADU Preapproval)",
    "state": "IL"
  },
  {
    "city": "Columbia IL",
    "label": "Columbia IL",
    "state": "IL"
  },
  {
    "city": "Cook County",
    "label": "Cook County",
    "state": "IL"
  },
  {
    "city": "Cook County (Asbestos Demolition)",
    "label": "Cook County (Asbestos Demolition)",
    "state": "IL"
  },
  {
    "city": "Des Plaines",
    "label": "Des Plaines",
    "state": "IL"
  },
  {
    "city": "East Peoria",
    "label": "East Peoria",
    "state": "IL"
  },
  {
    "city": "Elmhurst",
    "label": "Elmhurst",
    "state": "IL"
  },
  {
    "city": "Heyworth",
    "label": "Heyworth",
    "state": "IL"
  },
  {
    "city": "Illinois (Illinois Shines)",
    "label": "Illinois (Illinois Shines)",
    "state": "IL"
  },
  {
    "city": "Naperville",
    "label": "Naperville",
    "state": "IL"
  },
  {
    "city": "Palatine",
    "label": "Palatine",
    "state": "IL"
  },
  {
    "city": "Parkridge",
    "label": "Parkridge",
    "state": "IL"
  },
  {
    "city": "Peoria County",
    "label": "Peoria County",
    "state": "IL"
  },
  {
    "city": "Rock Island",
    "label": "Rock Island",
    "state": "IL"
  },
  {
    "city": "Rockford",
    "label": "Rockford",
    "state": "IL"
  },
  {
    "city": "Urbana",
    "label": "Urbana",
    "state": "IL"
  },
  {
    "city": "Village of Oswego",
    "label": "Village of Oswego",
    "state": "IL"
  },
  {
    "city": "Village of Streamwood",
    "label": "Village of Streamwood",
    "state": "IL"
  },
  {
    "city": "Washington",
    "label": "Washington",
    "state": "IL"
  },
  {
    "city": "Indianapolis",
    "label": "Indianapolis",
    "state": "IN"
  },
  {
    "city": "LaPorte County",
    "label": "LaPorte County",
    "state": "IN"
  },
  {
    "city": "Noblesville",
    "label": "Noblesville",
    "state": "IN"
  },
  {
    "city": "Butler County",
    "label": "Butler County",
    "state": "KS"
  },
  {
    "city": "Derby KS",
    "label": "Derby KS",
    "state": "KS"
  },
  {
    "city": "Franklin County",
    "label": "Franklin County",
    "state": "KS"
  },
  {
    "city": "Hutchinson",
    "label": "Hutchinson",
    "state": "KS"
  },
  {
    "city": "Lansing",
    "label": "Lansing",
    "state": "KS"
  },
  {
    "city": "Leawood",
    "label": "Leawood",
    "state": "KS"
  },
  {
    "city": "Olathe",
    "label": "Olathe",
    "state": "KS"
  },
  {
    "city": "Ottawa",
    "label": "Ottawa",
    "state": "KS"
  },
  {
    "city": "Louisville",
    "label": "Louisville",
    "state": "KY"
  },
  {
    "city": "Louisville Metro",
    "label": "Louisville Metro",
    "state": "KY"
  },
  {
    "city": "Paducah",
    "label": "Paducah",
    "state": "KY"
  },
  {
    "city": "Richmond",
    "label": "Richmond",
    "state": "KY"
  },
  {
    "city": "Baton Rouge",
    "label": "Baton Rouge",
    "state": "LA"
  },
  {
    "city": "New Orleans (Active)",
    "label": "New Orleans (Active)",
    "state": "LA"
  },
  {
    "city": "New Orleans (Permits)",
    "label": "New Orleans (Permits)",
    "state": "LA"
  },
  {
    "city": "Youngsville LA",
    "label": "Youngsville LA",
    "state": "LA"
  },
  {
    "city": "Boston",
    "label": "Boston",
    "state": "MA"
  },
  {
    "city": "Cambridge",
    "label": "Cambridge",
    "state": "MA"
  },
  {
    "city": "Cambridge (Additions)",
    "label": "Cambridge (Additions)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Asbestos Removal)",
    "label": "Cambridge (Asbestos Removal)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Demolition)",
    "label": "Cambridge (Demolition)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Electrical)",
    "label": "Cambridge (Electrical)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Mechanical)",
    "label": "Cambridge (Mechanical)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Plumbing)",
    "label": "Cambridge (Plumbing)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Roofing)",
    "label": "Cambridge (Roofing)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Siding)",
    "label": "Cambridge (Siding)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Solar Installations)",
    "label": "Cambridge (Solar Installations)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Solar)",
    "label": "Cambridge (Solar)",
    "state": "MA"
  },
  {
    "city": "Cambridge (Tent Permits)",
    "label": "Cambridge (Tent Permits)",
    "state": "MA"
  },
  {
    "city": "Falmouth",
    "label": "Falmouth",
    "state": "MA"
  },
  {
    "city": "Framingham",
    "label": "Framingham",
    "state": "MA"
  },
  {
    "city": "Hingham",
    "label": "Hingham",
    "state": "MA"
  },
  {
    "city": "Malden",
    "label": "Malden",
    "state": "MA"
  },
  {
    "city": "Massachusetts (LBNL Tracking the Sun)",
    "label": "Massachusetts (LBNL Tracking the Sun)",
    "state": "MA"
  },
  {
    "city": "Maynard",
    "label": "Maynard",
    "state": "MA"
  },
  {
    "city": "Norwood",
    "label": "Norwood",
    "state": "MA"
  },
  {
    "city": "Somerville",
    "label": "Somerville",
    "state": "MA"
  },
  {
    "city": "Somerville (Applications)",
    "label": "Somerville (Applications)",
    "state": "MA"
  },
  {
    "city": "Taunton",
    "label": "Taunton",
    "state": "MA"
  },
  {
    "city": "Worcester",
    "label": "Worcester",
    "state": "MA"
  },
  {
    "city": "Anne Arundel County",
    "label": "Anne Arundel County",
    "state": "MD"
  },
  {
    "city": "Baltimore",
    "label": "Baltimore",
    "state": "MD"
  },
  {
    "city": "Baltimore County",
    "label": "Baltimore County",
    "state": "MD"
  },
  {
    "city": "Frederick",
    "label": "Frederick",
    "state": "MD"
  },
  {
    "city": "Howard County",
    "label": "Howard County",
    "state": "MD"
  },
  {
    "city": "Maryland (LBNL Tracking the Sun)",
    "label": "Maryland (LBNL Tracking the Sun)",
    "state": "MD"
  },
  {
    "city": "Montgomery County",
    "label": "Montgomery County",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Antenna/Wireless)",
    "label": "Montgomery County (Antenna/Wireless)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Commercial Fast Track)",
    "label": "Montgomery County (Commercial Fast Track)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Construction Activities)",
    "label": "Montgomery County (Construction Activities)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Electrical)",
    "label": "Montgomery County (Electrical)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Fence)",
    "label": "Montgomery County (Fence)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Fire Alarm)",
    "label": "Montgomery County (Fire Alarm)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Fire Code Compliance)",
    "label": "Montgomery County (Fire Code Compliance)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Fire Protection)",
    "label": "Montgomery County (Fire Protection)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Historic Area)",
    "label": "Montgomery County (Historic Area)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Mechanical)",
    "label": "Montgomery County (Mechanical)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Open ROW)",
    "label": "Montgomery County (Open ROW)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Retaining Wall)",
    "label": "Montgomery County (Retaining Wall)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Right of Way)",
    "label": "Montgomery County (Right of Way)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Sewage Disposal)",
    "label": "Montgomery County (Sewage Disposal)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Sign)",
    "label": "Montgomery County (Sign)",
    "state": "MD"
  },
  {
    "city": "Montgomery County (Use and Occupancy)",
    "label": "Montgomery County (Use and Occupancy)",
    "state": "MD"
  },
  {
    "city": "Montgomery County Commercial",
    "label": "Montgomery County Commercial",
    "state": "MD"
  },
  {
    "city": "Ocean City",
    "label": "Ocean City",
    "state": "MD"
  },
  {
    "city": "Queenannes County",
    "label": "Queenannes County",
    "state": "MD"
  },
  {
    "city": "Cape Elizabeth",
    "label": "Cape Elizabeth",
    "state": "ME"
  },
  {
    "city": "Hampden",
    "label": "Hampden",
    "state": "ME"
  },
  {
    "city": "Lewiston",
    "label": "Lewiston",
    "state": "ME"
  },
  {
    "city": "Maine (LBNL Tracking the Sun)",
    "label": "Maine (LBNL Tracking the Sun)",
    "state": "ME"
  },
  {
    "city": "Portland (ME)",
    "label": "Portland (ME)",
    "state": "ME"
  },
  {
    "city": "Detroit",
    "label": "Detroit",
    "state": "MI"
  },
  {
    "city": "Grand Rapids",
    "label": "Grand Rapids",
    "state": "MI"
  },
  {
    "city": "Apple Valley",
    "label": "Apple Valley",
    "state": "MN"
  },
  {
    "city": "Bloomington",
    "label": "Bloomington",
    "state": "MN"
  },
  {
    "city": "Crystal",
    "label": "Crystal",
    "state": "MN"
  },
  {
    "city": "Eagan",
    "label": "Eagan",
    "state": "MN"
  },
  {
    "city": "Eden Prairie",
    "label": "Eden Prairie",
    "state": "MN"
  },
  {
    "city": "Edina",
    "label": "Edina",
    "state": "MN"
  },
  {
    "city": "Faribault",
    "label": "Faribault",
    "state": "MN"
  },
  {
    "city": "Golden Valley",
    "label": "Golden Valley",
    "state": "MN"
  },
  {
    "city": "Le Sueur",
    "label": "Le Sueur",
    "state": "MN"
  },
  {
    "city": "Le Sueur County",
    "label": "Le Sueur County",
    "state": "MN"
  },
  {
    "city": "Mankato",
    "label": "Mankato",
    "state": "MN"
  },
  {
    "city": "Maple Grove",
    "label": "Maple Grove",
    "state": "MN"
  },
  {
    "city": "Minneapolis",
    "label": "Minneapolis",
    "state": "MN"
  },
  {
    "city": "Minnesota (LBNL Tracking the Sun)",
    "label": "Minnesota (LBNL Tracking the Sun)",
    "state": "MN"
  },
  {
    "city": "Minnetonka",
    "label": "Minnetonka",
    "state": "MN"
  },
  {
    "city": "Pope County",
    "label": "Pope County",
    "state": "MN"
  },
  {
    "city": "Ramsey",
    "label": "Ramsey",
    "state": "MN"
  },
  {
    "city": "Red Wing",
    "label": "Red Wing",
    "state": "MN"
  },
  {
    "city": "Saint Paul",
    "label": "Saint Paul",
    "state": "MN"
  },
  {
    "city": "Savage",
    "label": "Savage",
    "state": "MN"
  },
  {
    "city": "Shakopee",
    "label": "Shakopee",
    "state": "MN"
  },
  {
    "city": "South St. Paul",
    "label": "South St. Paul",
    "state": "MN"
  },
  {
    "city": "St. Louis Park",
    "label": "St. Louis Park",
    "state": "MN"
  },
  {
    "city": "Waconia",
    "label": "Waconia",
    "state": "MN"
  },
  {
    "city": "White Bear Lake",
    "label": "White Bear Lake",
    "state": "MN"
  },
  {
    "city": "Blue Springs",
    "label": "Blue Springs",
    "state": "MO"
  },
  {
    "city": "Columbia (MO)",
    "label": "Columbia (MO)",
    "state": "MO"
  },
  {
    "city": "Farmington",
    "label": "Farmington",
    "state": "MO"
  },
  {
    "city": "Joplin",
    "label": "Joplin",
    "state": "MO"
  },
  {
    "city": "Kansas City",
    "label": "Kansas City",
    "state": "MO"
  },
  {
    "city": "Kansas City (Historical)",
    "label": "Kansas City (Historical)",
    "state": "MO"
  },
  {
    "city": "Peculiar",
    "label": "Peculiar",
    "state": "MO"
  },
  {
    "city": "St. Louis",
    "label": "St. Louis",
    "state": "MO"
  },
  {
    "city": "Warrensburg",
    "label": "Warrensburg",
    "state": "MO"
  },
  {
    "city": "Gautier",
    "label": "Gautier",
    "state": "MS"
  },
  {
    "city": "Hattiesburg",
    "label": "Hattiesburg",
    "state": "MS"
  },
  {
    "city": "Olive Branch",
    "label": "Olive Branch",
    "state": "MS"
  },
  {
    "city": "Ripley",
    "label": "Ripley",
    "state": "MS"
  },
  {
    "city": "Southaven",
    "label": "Southaven",
    "state": "MS"
  },
  {
    "city": "Great Falls",
    "label": "Great Falls",
    "state": "MT"
  },
  {
    "city": "Helena",
    "label": "Helena",
    "state": "MT"
  },
  {
    "city": "Kalispell",
    "label": "Kalispell",
    "state": "MT"
  },
  {
    "city": "Aberdeen",
    "label": "Aberdeen",
    "state": "NC"
  },
  {
    "city": "Alamance County",
    "label": "Alamance County",
    "state": "NC"
  },
  {
    "city": "Asheville",
    "label": "Asheville",
    "state": "NC"
  },
  {
    "city": "Brunswick County",
    "label": "Brunswick County",
    "state": "NC"
  },
  {
    "city": "Cary",
    "label": "Cary",
    "state": "NC"
  },
  {
    "city": "Charlotte (Mecklenburg)",
    "label": "Charlotte (Mecklenburg)",
    "state": "NC"
  },
  {
    "city": "Cumberland County",
    "label": "Cumberland County",
    "state": "NC"
  },
  {
    "city": "Durham",
    "label": "Durham",
    "state": "NC"
  },
  {
    "city": "Gaston County",
    "label": "Gaston County",
    "state": "NC"
  },
  {
    "city": "Greensboro",
    "label": "Greensboro",
    "state": "NC"
  },
  {
    "city": "Guilford County",
    "label": "Guilford County",
    "state": "NC"
  },
  {
    "city": "Harnett County",
    "label": "Harnett County",
    "state": "NC"
  },
  {
    "city": "Kernersville",
    "label": "Kernersville",
    "state": "NC"
  },
  {
    "city": "Mebane",
    "label": "Mebane",
    "state": "NC"
  },
  {
    "city": "Morrisville",
    "label": "Morrisville",
    "state": "NC"
  },
  {
    "city": "New Hanover County",
    "label": "New Hanover County",
    "state": "NC"
  },
  {
    "city": "Newbern",
    "label": "Newbern",
    "state": "NC"
  },
  {
    "city": "Pitt County",
    "label": "Pitt County",
    "state": "NC"
  },
  {
    "city": "Raleigh",
    "label": "Raleigh",
    "state": "NC"
  },
  {
    "city": "Rutherford County",
    "label": "Rutherford County",
    "state": "NC"
  },
  {
    "city": "Sanford",
    "label": "Sanford",
    "state": "NC"
  },
  {
    "city": "Wake County",
    "label": "Wake County",
    "state": "NC"
  },
  {
    "city": "Wake Forest",
    "label": "Wake Forest",
    "state": "NC"
  },
  {
    "city": "Waxhaw Permits",
    "label": "Waxhaw Permits",
    "state": "NC"
  },
  {
    "city": "Wilmington",
    "label": "Wilmington",
    "state": "NC"
  },
  {
    "city": "Bismarck",
    "label": "Bismarck",
    "state": "ND"
  },
  {
    "city": "Fargo",
    "label": "Fargo",
    "state": "ND"
  },
  {
    "city": "Fremont",
    "label": "Fremont",
    "state": "NE"
  },
  {
    "city": "Lincoln",
    "label": "Lincoln",
    "state": "NE"
  },
  {
    "city": "Omaha",
    "label": "Omaha",
    "state": "NE"
  },
  {
    "city": "Bow",
    "label": "Bow",
    "state": "NH"
  },
  {
    "city": "Dover (NH)",
    "label": "Dover (NH)",
    "state": "NH"
  },
  {
    "city": "Meredith",
    "label": "Meredith",
    "state": "NH"
  },
  {
    "city": "New Hampshire (LBNL Tracking the Sun)",
    "label": "New Hampshire (LBNL Tracking the Sun)",
    "state": "NH"
  },
  {
    "city": "Jersey City",
    "label": "Jersey City",
    "state": "NJ"
  },
  {
    "city": "New Jersey",
    "label": "New Jersey",
    "state": "NJ"
  },
  {
    "city": "New Jersey (Solar Activity Report)",
    "label": "New Jersey (Solar Activity Report)",
    "state": "NJ"
  },
  {
    "city": "Albuquerque",
    "label": "Albuquerque",
    "state": "NM"
  },
  {
    "city": "Bernalillo County",
    "label": "Bernalillo County",
    "state": "NM"
  },
  {
    "city": "Clovis",
    "label": "Clovis",
    "state": "NM"
  },
  {
    "city": "Las Cruces",
    "label": "Las Cruces",
    "state": "NM"
  },
  {
    "city": "Los Alamos County",
    "label": "Los Alamos County",
    "state": "NM"
  },
  {
    "city": "New Mexico (LBNL Tracking the Sun)",
    "label": "New Mexico (LBNL Tracking the Sun)",
    "state": "NM"
  },
  {
    "city": "Santa Fe",
    "label": "Santa Fe",
    "state": "NM"
  },
  {
    "city": "Henderson",
    "label": "Henderson",
    "state": "NV"
  },
  {
    "city": "Henderson Other",
    "label": "Henderson Other",
    "state": "NV"
  },
  {
    "city": "Henderson Residential",
    "label": "Henderson Residential",
    "state": "NV"
  },
  {
    "city": "Las Vegas",
    "label": "Las Vegas",
    "state": "NV"
  },
  {
    "city": "Reno",
    "label": "Reno",
    "state": "NV"
  },
  {
    "city": "Washoe County",
    "label": "Washoe County",
    "state": "NV"
  },
  {
    "city": "Albany",
    "label": "Albany",
    "state": "NY"
  },
  {
    "city": "AlbanyNY",
    "label": "AlbanyNY",
    "state": "NY"
  },
  {
    "city": "Buffalo",
    "label": "Buffalo",
    "state": "NY"
  },
  {
    "city": "Monroe",
    "label": "Monroe",
    "state": "NY"
  },
  {
    "city": "New York (NY-Sun)",
    "label": "New York (NY-Sun)",
    "state": "NY"
  },
  {
    "city": "New York (NYSERDA Storage)",
    "label": "New York (NYSERDA Storage)",
    "state": "NY"
  },
  {
    "city": "New York (Statewide Solar)",
    "label": "New York (Statewide Solar)",
    "state": "NY"
  },
  {
    "city": "New York (Statewide Storage)",
    "label": "New York (Statewide Storage)",
    "state": "NY"
  },
  {
    "city": "New York City",
    "label": "New York City",
    "state": "NY"
  },
  {
    "city": "NYC (DOB NOW Electrical Applications)",
    "label": "NYC (DOB NOW Electrical Applications)",
    "state": "NY"
  },
  {
    "city": "NYC (LPC Permit Applications)",
    "label": "NYC (LPC Permit Applications)",
    "state": "NY"
  },
  {
    "city": "Perinton",
    "label": "Perinton",
    "state": "NY"
  },
  {
    "city": "Rockland County",
    "label": "Rockland County",
    "state": "NY"
  },
  {
    "city": "Syracuse",
    "label": "Syracuse",
    "state": "NY"
  },
  {
    "city": "Wellsville",
    "label": "Wellsville",
    "state": "NY"
  },
  {
    "city": "Cincinnati",
    "label": "Cincinnati",
    "state": "OH"
  },
  {
    "city": "Clermont County, Ohio Permit Central",
    "label": "Clermont County, Ohio Permit Central",
    "state": "OH"
  },
  {
    "city": "Cleveland",
    "label": "Cleveland",
    "state": "OH"
  },
  {
    "city": "Columbus",
    "label": "Columbus",
    "state": "OH"
  },
  {
    "city": "North Olmsted OH",
    "label": "North Olmsted OH",
    "state": "OH"
  },
  {
    "city": "Ohio (LBNL Tracking the Sun)",
    "label": "Ohio (LBNL Tracking the Sun)",
    "state": "OH"
  },
  {
    "city": "Oxford",
    "label": "Oxford",
    "state": "OH"
  },
  {
    "city": "SolonOH",
    "label": "SolonOH",
    "state": "OH"
  },
  {
    "city": "Zanesville",
    "label": "Zanesville",
    "state": "OH"
  },
  {
    "city": "Newcastle",
    "label": "Newcastle",
    "state": "OK"
  },
  {
    "city": "Oklahoma City",
    "label": "Oklahoma City",
    "state": "OK"
  },
  {
    "city": "Owasso",
    "label": "Owasso",
    "state": "OK"
  },
  {
    "city": "Tulsa",
    "label": "Tulsa",
    "state": "OK"
  },
  {
    "city": "Ashland",
    "label": "Ashland",
    "state": "OR"
  },
  {
    "city": "Astoria",
    "label": "Astoria",
    "state": "OR"
  },
  {
    "city": "Aurora",
    "label": "Aurora",
    "state": "OR"
  },
  {
    "city": "Baker City",
    "label": "Baker City",
    "state": "OR"
  },
  {
    "city": "Bcd Salem",
    "label": "Bcd Salem",
    "state": "OR"
  },
  {
    "city": "Beaverton",
    "label": "Beaverton",
    "state": "OR"
  },
  {
    "city": "Bend",
    "label": "Bend",
    "state": "OR"
  },
  {
    "city": "Benton County",
    "label": "Benton County",
    "state": "OR"
  },
  {
    "city": "Brookings",
    "label": "Brookings",
    "state": "OR"
  },
  {
    "city": "Cannon Beach",
    "label": "Cannon Beach",
    "state": "OR"
  },
  {
    "city": "Central Point",
    "label": "Central Point",
    "state": "OR"
  },
  {
    "city": "Clackamas",
    "label": "Clackamas",
    "state": "OR"
  },
  {
    "city": "Clatskanie",
    "label": "Clatskanie",
    "state": "OR"
  },
  {
    "city": "Clatsop County",
    "label": "Clatsop County",
    "state": "OR"
  },
  {
    "city": "Coburg",
    "label": "Coburg",
    "state": "OR"
  },
  {
    "city": "Columbia City",
    "label": "Columbia City",
    "state": "OR"
  },
  {
    "city": "Columbia County",
    "label": "Columbia County",
    "state": "OR"
  },
  {
    "city": "Coos Bay",
    "label": "Coos Bay",
    "state": "OR"
  },
  {
    "city": "Coos County",
    "label": "Coos County",
    "state": "OR"
  },
  {
    "city": "Cornelius",
    "label": "Cornelius",
    "state": "OR"
  },
  {
    "city": "Corvallis",
    "label": "Corvallis",
    "state": "OR"
  },
  {
    "city": "Cottage Grove",
    "label": "Cottage Grove",
    "state": "OR"
  },
  {
    "city": "Creswell",
    "label": "Creswell",
    "state": "OR"
  },
  {
    "city": "Crook County",
    "label": "Crook County",
    "state": "OR"
  },
  {
    "city": "Curry County",
    "label": "Curry County",
    "state": "OR"
  },
  {
    "city": "Deschutes County",
    "label": "Deschutes County",
    "state": "OR"
  },
  {
    "city": "Dunes City",
    "label": "Dunes City",
    "state": "OR"
  },
  {
    "city": "Estacada",
    "label": "Estacada",
    "state": "OR"
  },
  {
    "city": "Fairview",
    "label": "Fairview",
    "state": "OR"
  },
  {
    "city": "Forest Grove",
    "label": "Forest Grove",
    "state": "OR"
  },
  {
    "city": "Gearhart",
    "label": "Gearhart",
    "state": "OR"
  },
  {
    "city": "Gilliam County",
    "label": "Gilliam County",
    "state": "OR"
  },
  {
    "city": "Grant County",
    "label": "Grant County",
    "state": "OR"
  },
  {
    "city": "Gresham",
    "label": "Gresham",
    "state": "OR"
  },
  {
    "city": "Happy Valley",
    "label": "Happy Valley",
    "state": "OR"
  },
  {
    "city": "Harney County",
    "label": "Harney County",
    "state": "OR"
  },
  {
    "city": "Harrisburg",
    "label": "Harrisburg",
    "state": "OR"
  },
  {
    "city": "Hermiston",
    "label": "Hermiston",
    "state": "OR"
  },
  {
    "city": "Hillsboro",
    "label": "Hillsboro",
    "state": "OR"
  },
  {
    "city": "Hood River",
    "label": "Hood River",
    "state": "OR"
  },
  {
    "city": "Hood River County",
    "label": "Hood River County",
    "state": "OR"
  },
  {
    "city": "Independence",
    "label": "Independence",
    "state": "OR"
  },
  {
    "city": "Jackson County",
    "label": "Jackson County",
    "state": "OR"
  },
  {
    "city": "Jacksonville Or",
    "label": "Jacksonville Or",
    "state": "OR"
  },
  {
    "city": "Jefferson County",
    "label": "Jefferson County",
    "state": "OR"
  },
  {
    "city": "Junction City",
    "label": "Junction City",
    "state": "OR"
  },
  {
    "city": "King City",
    "label": "King City",
    "state": "OR"
  },
  {
    "city": "Klamath County",
    "label": "Klamath County",
    "state": "OR"
  },
  {
    "city": "Lafayette",
    "label": "Lafayette",
    "state": "OR"
  },
  {
    "city": "Lagrande",
    "label": "Lagrande",
    "state": "OR"
  },
  {
    "city": "Lake County",
    "label": "Lake County",
    "state": "OR"
  },
  {
    "city": "Lake Oswego",
    "label": "Lake Oswego",
    "state": "OR"
  },
  {
    "city": "Lakeside",
    "label": "Lakeside",
    "state": "OR"
  },
  {
    "city": "Lane County",
    "label": "Lane County",
    "state": "OR"
  },
  {
    "city": "Lincoln City",
    "label": "Lincoln City",
    "state": "OR"
  },
  {
    "city": "Lincoln County",
    "label": "Lincoln County",
    "state": "OR"
  },
  {
    "city": "Linn County",
    "label": "Linn County",
    "state": "OR"
  },
  {
    "city": "Lowell",
    "label": "Lowell",
    "state": "OR"
  },
  {
    "city": "Malheur County",
    "label": "Malheur County",
    "state": "OR"
  },
  {
    "city": "Manzanita",
    "label": "Manzanita",
    "state": "OR"
  },
  {
    "city": "Marion County",
    "label": "Marion County",
    "state": "OR"
  },
  {
    "city": "Mcminnville",
    "label": "Mcminnville",
    "state": "OR"
  },
  {
    "city": "Milwaukie",
    "label": "Milwaukie",
    "state": "OR"
  },
  {
    "city": "Monmouth",
    "label": "Monmouth",
    "state": "OR"
  },
  {
    "city": "Multnomah County",
    "label": "Multnomah County",
    "state": "OR"
  },
  {
    "city": "Newport",
    "label": "Newport",
    "state": "OR"
  },
  {
    "city": "North Bend",
    "label": "North Bend",
    "state": "OR"
  },
  {
    "city": "Oakridge",
    "label": "Oakridge",
    "state": "OR"
  },
  {
    "city": "Ontario",
    "label": "Ontario",
    "state": "OR"
  },
  {
    "city": "Oregon (LBNL Tracking the Sun)",
    "label": "Oregon (LBNL Tracking the Sun)",
    "state": "OR"
  },
  {
    "city": "Oregon (Solar+Storage Rebate)",
    "label": "Oregon (Solar+Storage Rebate)",
    "state": "OR"
  },
  {
    "city": "Oregon State (BCD)",
    "label": "Oregon State (BCD)",
    "state": "OR"
  },
  {
    "city": "Oregoncity",
    "label": "Oregoncity",
    "state": "OR"
  },
  {
    "city": "Pendleton",
    "label": "Pendleton",
    "state": "OR"
  },
  {
    "city": "Philomath",
    "label": "Philomath",
    "state": "OR"
  },
  {
    "city": "Phoenix",
    "label": "Phoenix",
    "state": "OR"
  },
  {
    "city": "Polk County",
    "label": "Polk County",
    "state": "OR"
  },
  {
    "city": "Portland",
    "label": "Portland",
    "state": "OR"
  },
  {
    "city": "Reedsport",
    "label": "Reedsport",
    "state": "OR"
  },
  {
    "city": "Rogue River",
    "label": "Rogue River",
    "state": "OR"
  },
  {
    "city": "Sandy",
    "label": "Sandy",
    "state": "OR"
  },
  {
    "city": "Scappoose",
    "label": "Scappoose",
    "state": "OR"
  },
  {
    "city": "Seaside",
    "label": "Seaside",
    "state": "OR"
  },
  {
    "city": "Sherman County",
    "label": "Sherman County",
    "state": "OR"
  },
  {
    "city": "Sherwood",
    "label": "Sherwood",
    "state": "OR"
  },
  {
    "city": "Sisters",
    "label": "Sisters",
    "state": "OR"
  },
  {
    "city": "Springfield",
    "label": "Springfield",
    "state": "OR"
  },
  {
    "city": "St Helens",
    "label": "St Helens",
    "state": "OR"
  },
  {
    "city": "Sweet Home",
    "label": "Sweet Home",
    "state": "OR"
  },
  {
    "city": "Talent",
    "label": "Talent",
    "state": "OR"
  },
  {
    "city": "Tigard",
    "label": "Tigard",
    "state": "OR"
  },
  {
    "city": "Tillamook County",
    "label": "Tillamook County",
    "state": "OR"
  },
  {
    "city": "Troutdale",
    "label": "Troutdale",
    "state": "OR"
  },
  {
    "city": "Umatilla",
    "label": "Umatilla",
    "state": "OR"
  },
  {
    "city": "Umatilla County",
    "label": "Umatilla County",
    "state": "OR"
  },
  {
    "city": "Veneta",
    "label": "Veneta",
    "state": "OR"
  },
  {
    "city": "Vernonia",
    "label": "Vernonia",
    "state": "OR"
  },
  {
    "city": "Wallowa County",
    "label": "Wallowa County",
    "state": "OR"
  },
  {
    "city": "Warrenton",
    "label": "Warrenton",
    "state": "OR"
  },
  {
    "city": "Wasco County",
    "label": "Wasco County",
    "state": "OR"
  },
  {
    "city": "West Linn",
    "label": "West Linn",
    "state": "OR"
  },
  {
    "city": "Wheeler County",
    "label": "Wheeler County",
    "state": "OR"
  },
  {
    "city": "Wilsonville",
    "label": "Wilsonville",
    "state": "OR"
  },
  {
    "city": "Woodburn",
    "label": "Woodburn",
    "state": "OR"
  },
  {
    "city": "Yamhill County",
    "label": "Yamhill County",
    "state": "OR"
  },
  {
    "city": "Lebanon",
    "label": "Lebanon",
    "state": "PA"
  },
  {
    "city": "Pennsylvania (LBNL Tracking the Sun)",
    "label": "Pennsylvania (LBNL Tracking the Sun)",
    "state": "PA"
  },
  {
    "city": "Philadelphia",
    "label": "Philadelphia",
    "state": "PA"
  },
  {
    "city": "Pittsburgh",
    "label": "Pittsburgh",
    "state": "PA"
  },
  {
    "city": "Reading",
    "label": "Reading",
    "state": "PA"
  },
  {
    "city": "Providence",
    "label": "Providence",
    "state": "RI"
  },
  {
    "city": "Rhode Island (LBNL Tracking the Sun)",
    "label": "Rhode Island (LBNL Tracking the Sun)",
    "state": "RI"
  },
  {
    "city": "West Greenwich",
    "label": "West Greenwich",
    "state": "RI"
  },
  {
    "city": "Aiken",
    "label": "Aiken",
    "state": "SC"
  },
  {
    "city": "Beaufort",
    "label": "Beaufort",
    "state": "SC"
  },
  {
    "city": "Beaufort County",
    "label": "Beaufort County",
    "state": "SC"
  },
  {
    "city": "Charleston County",
    "label": "Charleston County",
    "state": "SC"
  },
  {
    "city": "Clemson",
    "label": "Clemson",
    "state": "SC"
  },
  {
    "city": "Columbia",
    "label": "Columbia",
    "state": "SC"
  },
  {
    "city": "Darlington County",
    "label": "Darlington County",
    "state": "SC"
  },
  {
    "city": "Florence",
    "label": "Florence",
    "state": "SC"
  },
  {
    "city": "Follybeach",
    "label": "Follybeach",
    "state": "SC"
  },
  {
    "city": "Georgetown County",
    "label": "Georgetown County",
    "state": "SC"
  },
  {
    "city": "Greenville",
    "label": "Greenville",
    "state": "SC"
  },
  {
    "city": "Hilton Head Island",
    "label": "Hilton Head Island",
    "state": "SC"
  },
  {
    "city": "Horry County",
    "label": "Horry County",
    "state": "SC"
  },
  {
    "city": "North Charleston",
    "label": "North Charleston",
    "state": "SC"
  },
  {
    "city": "Pickens County",
    "label": "Pickens County",
    "state": "SC"
  },
  {
    "city": "Spartanburg",
    "label": "Spartanburg",
    "state": "SC"
  },
  {
    "city": "Spartanburg County",
    "label": "Spartanburg County",
    "state": "SC"
  },
  {
    "city": "Boxelder",
    "label": "Boxelder",
    "state": "SD"
  },
  {
    "city": "Sioux Falls",
    "label": "Sioux Falls",
    "state": "SD"
  },
  {
    "city": "Chattanooga",
    "label": "Chattanooga",
    "state": "TN"
  },
  {
    "city": "Clarksville",
    "label": "Clarksville",
    "state": "TN"
  },
  {
    "city": "Gallatin",
    "label": "Gallatin",
    "state": "TN"
  },
  {
    "city": "Hamilton County",
    "label": "Hamilton County",
    "state": "TN"
  },
  {
    "city": "Hendersonville",
    "label": "Hendersonville",
    "state": "TN"
  },
  {
    "city": "Knox County",
    "label": "Knox County",
    "state": "TN"
  },
  {
    "city": "La Vergne Permitting",
    "label": "La Vergne Permitting",
    "state": "TN"
  },
  {
    "city": "McMinnville",
    "label": "McMinnville",
    "state": "TN"
  },
  {
    "city": "Memphis",
    "label": "Memphis",
    "state": "TN"
  },
  {
    "city": "Nashville",
    "label": "Nashville",
    "state": "TN"
  },
  {
    "city": "Nashville (ArcGIS)",
    "label": "Nashville (ArcGIS)",
    "state": "TN"
  },
  {
    "city": "Nashville Trade Permits",
    "label": "Nashville Trade Permits",
    "state": "TN"
  },
  {
    "city": "Shelby County",
    "label": "Shelby County",
    "state": "TN"
  },
  {
    "city": "White House TN",
    "label": "White House TN",
    "state": "TN"
  },
  {
    "city": "Allen",
    "label": "Allen",
    "state": "TX"
  },
  {
    "city": "Arlington",
    "label": "Arlington",
    "state": "TX"
  },
  {
    "city": "Austin",
    "label": "Austin",
    "state": "TX"
  },
  {
    "city": "Bowie",
    "label": "Bowie",
    "state": "TX"
  },
  {
    "city": "Cedarhill",
    "label": "Cedarhill",
    "state": "TX"
  },
  {
    "city": "College Station",
    "label": "College Station",
    "state": "TX"
  },
  {
    "city": "Collin County",
    "label": "Collin County",
    "state": "TX"
  },
  {
    "city": "Dallas",
    "label": "Dallas",
    "state": "TX"
  },
  {
    "city": "Deer Park, Texas",
    "label": "Deer Park, Texas",
    "state": "TX"
  },
  {
    "city": "DelRioTX",
    "label": "DelRioTX",
    "state": "TX"
  },
  {
    "city": "Denton",
    "label": "Denton",
    "state": "TX"
  },
  {
    "city": "Denton County",
    "label": "Denton County",
    "state": "TX"
  },
  {
    "city": "DeSoto",
    "label": "DeSoto",
    "state": "TX"
  },
  {
    "city": "El Paso",
    "label": "El Paso",
    "state": "TX"
  },
  {
    "city": "El Paso Residential",
    "label": "El Paso Residential",
    "state": "TX"
  },
  {
    "city": "Fort Worth",
    "label": "Fort Worth",
    "state": "TX"
  },
  {
    "city": "Frisco",
    "label": "Frisco",
    "state": "TX"
  },
  {
    "city": "Gainesville",
    "label": "Gainesville",
    "state": "TX"
  },
  {
    "city": "Granbury",
    "label": "Granbury",
    "state": "TX"
  },
  {
    "city": "Grand Prairie",
    "label": "Grand Prairie",
    "state": "TX"
  },
  {
    "city": "Groves",
    "label": "Groves",
    "state": "TX"
  },
  {
    "city": "Hutto",
    "label": "Hutto",
    "state": "TX"
  },
  {
    "city": "Irving (Commercial)",
    "label": "Irving (Commercial)",
    "state": "TX"
  },
  {
    "city": "Irving (Residential)",
    "label": "Irving (Residential)",
    "state": "TX"
  },
  {
    "city": "Keller",
    "label": "Keller",
    "state": "TX"
  },
  {
    "city": "Kerrville",
    "label": "Kerrville",
    "state": "TX"
  },
  {
    "city": "Kyle",
    "label": "Kyle",
    "state": "TX"
  },
  {
    "city": "La Porte",
    "label": "La Porte",
    "state": "TX"
  },
  {
    "city": "Lake Jackson",
    "label": "Lake Jackson",
    "state": "TX"
  },
  {
    "city": "Laredo",
    "label": "Laredo",
    "state": "TX"
  },
  {
    "city": "League City",
    "label": "League City",
    "state": "TX"
  },
  {
    "city": "Leander",
    "label": "Leander",
    "state": "TX"
  },
  {
    "city": "Manor",
    "label": "Manor",
    "state": "TX"
  },
  {
    "city": "Mesquite",
    "label": "Mesquite",
    "state": "TX"
  },
  {
    "city": "North Richland Hills",
    "label": "North Richland Hills",
    "state": "TX"
  },
  {
    "city": "Pasadena",
    "label": "Pasadena",
    "state": "TX"
  },
  {
    "city": "Port Arthur",
    "label": "Port Arthur",
    "state": "TX"
  },
  {
    "city": "Princeton TX",
    "label": "Princeton TX",
    "state": "TX"
  },
  {
    "city": "Prosper",
    "label": "Prosper",
    "state": "TX"
  },
  {
    "city": "San Antonio",
    "label": "San Antonio",
    "state": "TX"
  },
  {
    "city": "San Marcos",
    "label": "San Marcos",
    "state": "TX"
  },
  {
    "city": "Sherman",
    "label": "Sherman",
    "state": "TX"
  },
  {
    "city": "Sugar Land",
    "label": "Sugar Land",
    "state": "TX"
  },
  {
    "city": "Texas (LBNL Tracking the Sun)",
    "label": "Texas (LBNL Tracking the Sun)",
    "state": "TX"
  },
  {
    "city": "Waco",
    "label": "Waco",
    "state": "TX"
  },
  {
    "city": "Williamson County",
    "label": "Williamson County",
    "state": "TX"
  },
  {
    "city": "Provo City",
    "label": "Provo City",
    "state": "UT"
  },
  {
    "city": "Salt Lake City",
    "label": "Salt Lake City",
    "state": "UT"
  },
  {
    "city": "Salt Lake County MSD",
    "label": "Salt Lake County MSD",
    "state": "UT"
  },
  {
    "city": "Summit County",
    "label": "Summit County",
    "state": "UT"
  },
  {
    "city": "Utah (LBNL Tracking the Sun)",
    "label": "Utah (LBNL Tracking the Sun)",
    "state": "UT"
  },
  {
    "city": "Utah County",
    "label": "Utah County",
    "state": "UT"
  },
  {
    "city": "Albemarle County",
    "label": "Albemarle County",
    "state": "VA"
  },
  {
    "city": "Charlottesville",
    "label": "Charlottesville",
    "state": "VA"
  },
  {
    "city": "Chesapeake",
    "label": "Chesapeake",
    "state": "VA"
  },
  {
    "city": "Chesterfield County",
    "label": "Chesterfield County",
    "state": "VA"
  },
  {
    "city": "Craig County",
    "label": "Craig County",
    "state": "VA"
  },
  {
    "city": "Fairfax County",
    "label": "Fairfax County",
    "state": "VA"
  },
  {
    "city": "Fairfax County (VA Open Data)",
    "label": "Fairfax County (VA Open Data)",
    "state": "VA"
  },
  {
    "city": "FluvannaCountyVA",
    "label": "FluvannaCountyVA",
    "state": "VA"
  },
  {
    "city": "Hanover County",
    "label": "Hanover County",
    "state": "VA"
  },
  {
    "city": "James City County",
    "label": "James City County",
    "state": "VA"
  },
  {
    "city": "Lynchburg",
    "label": "Lynchburg",
    "state": "VA"
  },
  {
    "city": "Manassas",
    "label": "Manassas",
    "state": "VA"
  },
  {
    "city": "Newkent County",
    "label": "Newkent County",
    "state": "VA"
  },
  {
    "city": "Norfolk",
    "label": "Norfolk",
    "state": "VA"
  },
  {
    "city": "Norfolk (VA Open Data)",
    "label": "Norfolk (VA Open Data)",
    "state": "VA"
  },
  {
    "city": "Prince William County",
    "label": "Prince William County",
    "state": "VA"
  },
  {
    "city": "Richmond (VA)",
    "label": "Richmond (VA)",
    "state": "VA"
  },
  {
    "city": "Staunton",
    "label": "Staunton",
    "state": "VA"
  },
  {
    "city": "Virginia (LBNL Tracking the Sun)",
    "label": "Virginia (LBNL Tracking the Sun)",
    "state": "VA"
  },
  {
    "city": "Virginia Beach",
    "label": "Virginia Beach",
    "state": "VA"
  },
  {
    "city": "Virginia Beach (City)",
    "label": "Virginia Beach (City)",
    "state": "VA"
  },
  {
    "city": "Waynesboro",
    "label": "Waynesboro",
    "state": "VA"
  },
  {
    "city": "Winchester",
    "label": "Winchester",
    "state": "VA"
  },
  {
    "city": "Wythe County",
    "label": "Wythe County",
    "state": "VA"
  },
  {
    "city": "Burlington",
    "label": "Burlington",
    "state": "VT"
  },
  {
    "city": "Vermont (LBNL Tracking the Sun)",
    "label": "Vermont (LBNL Tracking the Sun)",
    "state": "VT"
  },
  {
    "city": "Adams County",
    "label": "Adams County",
    "state": "WA"
  },
  {
    "city": "Asotin",
    "label": "Asotin",
    "state": "WA"
  },
  {
    "city": "Auburn",
    "label": "Auburn",
    "state": "WA"
  },
  {
    "city": "BattleGround WA",
    "label": "BattleGround WA",
    "state": "WA"
  },
  {
    "city": "Bellevue",
    "label": "Bellevue",
    "state": "WA"
  },
  {
    "city": "Bingen",
    "label": "Bingen",
    "state": "WA"
  },
  {
    "city": "Bothell",
    "label": "Bothell",
    "state": "WA"
  },
  {
    "city": "Camas",
    "label": "Camas",
    "state": "WA"
  },
  {
    "city": "Clallam County",
    "label": "Clallam County",
    "state": "WA"
  },
  {
    "city": "Clarkston",
    "label": "Clarkston",
    "state": "WA"
  },
  {
    "city": "Everett",
    "label": "Everett",
    "state": "WA"
  },
  {
    "city": "Gig Harbor",
    "label": "Gig Harbor",
    "state": "WA"
  },
  {
    "city": "Kent",
    "label": "Kent",
    "state": "WA"
  },
  {
    "city": "King County",
    "label": "King County",
    "state": "WA"
  },
  {
    "city": "Kitsap County",
    "label": "Kitsap County",
    "state": "WA"
  },
  {
    "city": "North Bonneville",
    "label": "North Bonneville",
    "state": "WA"
  },
  {
    "city": "Orting",
    "label": "Orting",
    "state": "WA"
  },
  {
    "city": "Pierce County",
    "label": "Pierce County",
    "state": "WA"
  },
  {
    "city": "Port Angeles",
    "label": "Port Angeles",
    "state": "WA"
  },
  {
    "city": "Pullman",
    "label": "Pullman",
    "state": "WA"
  },
  {
    "city": "Redmond",
    "label": "Redmond",
    "state": "WA"
  },
  {
    "city": "Renton",
    "label": "Renton",
    "state": "WA"
  },
  {
    "city": "Sammamish",
    "label": "Sammamish",
    "state": "WA"
  },
  {
    "city": "Seattle",
    "label": "Seattle",
    "state": "WA"
  },
  {
    "city": "Seattle (Land Use)",
    "label": "Seattle (Land Use)",
    "state": "WA"
  },
  {
    "city": "Seattle (Plan Review)",
    "label": "Seattle (Plan Review)",
    "state": "WA"
  },
  {
    "city": "Seattle Electrical",
    "label": "Seattle Electrical",
    "state": "WA"
  },
  {
    "city": "Seattle Trade",
    "label": "Seattle Trade",
    "state": "WA"
  },
  {
    "city": "Sequim",
    "label": "Sequim",
    "state": "WA"
  },
  {
    "city": "Shelton",
    "label": "Shelton",
    "state": "WA"
  },
  {
    "city": "Skagit County",
    "label": "Skagit County",
    "state": "WA"
  },
  {
    "city": "Skamania County",
    "label": "Skamania County",
    "state": "WA"
  },
  {
    "city": "Snohomish",
    "label": "Snohomish",
    "state": "WA"
  },
  {
    "city": "Spokane",
    "label": "Spokane",
    "state": "WA"
  },
  {
    "city": "Stevenson",
    "label": "Stevenson",
    "state": "WA"
  },
  {
    "city": "Sumner",
    "label": "Sumner",
    "state": "WA"
  },
  {
    "city": "Tacoma",
    "label": "Tacoma",
    "state": "WA"
  },
  {
    "city": "Thurston County",
    "label": "Thurston County",
    "state": "WA"
  },
  {
    "city": "Walla Walla WA",
    "label": "Walla Walla WA",
    "state": "WA"
  },
  {
    "city": "Washington (LBNL Tracking the Sun)",
    "label": "Washington (LBNL Tracking the Sun)",
    "state": "WA"
  },
  {
    "city": "Washougal",
    "label": "Washougal",
    "state": "WA"
  },
  {
    "city": "West Richland",
    "label": "West Richland",
    "state": "WA"
  },
  {
    "city": "Whatcom County",
    "label": "Whatcom County",
    "state": "WA"
  },
  {
    "city": "Madison",
    "label": "Madison",
    "state": "WI"
  },
  {
    "city": "Milwaukee",
    "label": "Milwaukee",
    "state": "WI"
  },
  {
    "city": "Superior",
    "label": "Superior",
    "state": "WI"
  },
  {
    "city": "Wisconsin (LBNL Tracking the Sun)",
    "label": "Wisconsin (LBNL Tracking the Sun)",
    "state": "WI"
  },
  {
    "city": "Cabell County",
    "label": "Cabell County",
    "state": "WV"
  },
  {
    "city": "Charleston",
    "label": "Charleston",
    "state": "WV"
  },
  {
    "city": "Granville",
    "label": "Granville",
    "state": "WV"
  },
  {
    "city": "Harrison County",
    "label": "Harrison County",
    "state": "WV"
  },
  {
    "city": "Laramie",
    "label": "Laramie",
    "state": "WY"
  },
  {
    "city": "addition",
    "label": "Addition",
    "state": ""
  },
  {
    "city": "Cincinnati (Use Permits &amp; Licenses)",
    "label": "Cincinnati (Use Permits &amp; Licenses)",
    "state": ""
  },
  {
    "city": "demolition",
    "label": "Demolition",
    "state": ""
  },
  {
    "city": "electrical",
    "label": "Electrical",
    "state": ""
  },
  {
    "city": "ev_charger",
    "label": "EV Charger",
    "state": ""
  },
  {
    "city": "fence",
    "label": "Fence",
    "state": ""
  },
  {
    "city": "fire_alarm",
    "label": "Fire Alarm",
    "state": ""
  },
  {
    "city": "hvac",
    "label": "HVAC",
    "state": ""
  },
  {
    "city": "new_construction",
    "label": "New Construction",
    "state": ""
  },
  {
    "city": "Person County&#x27;s Citizen",
    "label": "Person County&#x27;s Citizen",
    "state": ""
  },
  {
    "city": "plumbing",
    "label": "Plumbing",
    "state": ""
  },
  {
    "city": "pool",
    "label": "Pool",
    "state": ""
  },
  {
    "city": "Prince George&#x27;s County (2013+)",
    "label": "Prince George&#x27;s County (2013+)",
    "state": ""
  },
  {
    "city": "Prince George&#x27;s County (Site Roads, 2023+)",
    "label": "Prince George&#x27;s County (Site Roads, 2023+)",
    "state": ""
  },
  {
    "city": "renovation",
    "label": "Renovation",
    "state": ""
  },
  {
    "city": "roofing",
    "label": "Roofing",
    "state": ""
  },
  {
    "city": "sign",
    "label": "Sign",
    "state": ""
  },
  {
    "city": "solar",
    "label": "Solar",
    "state": ""
  }
];

function normalizePermitStackCity(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return (
    PERMIT_STACK_CITIES.find(
      (c) => c.city.toLowerCase() === lower || c.label.toLowerCase() === lower
    ) || null
  );
}

function permitCitiesByState() {
  const groups = new Map();
  for (const row of PERMIT_STACK_CITIES) {
    const st = row.state || '—';
    if (!groups.has(st)) groups.set(st, []);
    groups.get(st).push(row);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

module.exports = {
  PERMIT_STACK_CITIES,
  normalizePermitStackCity,
  permitCitiesByState,
};
