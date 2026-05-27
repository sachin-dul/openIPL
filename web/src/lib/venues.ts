/**
 * Venue alias groups. Cricsheet sometimes records the same physical ground
 * under multiple slightly different strings (with/without city suffix,
 * different punctuation). Each inner array lists names that should be
 * collapsed to one venue. The first entry is the canonical name returned
 * by `canonicalVenue()`.
 *
 * NOTE: only obvious spelling/suffix variations are grouped here. Physical
 * stadium renames (e.g. "Sardar Patel Stadium, Motera" → "Narendra Modi
 * Stadium, Ahmedabad", or "Subrata Roy Sahara Stadium" → "Maharashtra
 * Cricket Association Stadium") are intentionally left separate — they
 * represent distinct branding eras, mirroring how the team aliases keep
 * Delhi Daredevils and Delhi Capitals separate.
 */
const VENUE_ALIASES: readonly (readonly string[])[] = [
  ["Arun Jaitley Stadium", "Arun Jaitley Stadium, Delhi"],
  ["Brabourne Stadium", "Brabourne Stadium, Mumbai"],
  ["Dr DY Patil Sports Academy", "Dr DY Patil Sports Academy, Mumbai"],
  [
    "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium",
    "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium, Visakhapatnam",
  ],
  ["Eden Gardens", "Eden Gardens, Kolkata"],
  [
    "Himachal Pradesh Cricket Association Stadium",
    "Himachal Pradesh Cricket Association Stadium, Dharamsala",
  ],
  [
    "M Chinnaswamy Stadium",
    "M Chinnaswamy Stadium, Bengaluru",
    "M.Chinnaswamy Stadium",
  ],
  [
    "MA Chidambaram Stadium",
    "MA Chidambaram Stadium, Chepauk",
    "MA Chidambaram Stadium, Chepauk, Chennai",
  ],
  [
    "Maharaja Yadavindra Singh International Cricket Stadium",
    "Maharaja Yadavindra Singh International Cricket Stadium, Mullanpur",
    "Maharaja Yadavindra Singh International Cricket Stadium, New Chandigarh",
  ],
  [
    "Maharashtra Cricket Association Stadium",
    "Maharashtra Cricket Association Stadium, Pune",
  ],
  [
    "Punjab Cricket Association IS Bindra Stadium",
    "Punjab Cricket Association IS Bindra Stadium, Mohali",
    "Punjab Cricket Association IS Bindra Stadium, Mohali, Chandigarh",
  ],
  [
    "Rajiv Gandhi International Stadium",
    "Rajiv Gandhi International Stadium, Uppal",
    "Rajiv Gandhi International Stadium, Uppal, Hyderabad",
  ],
  ["Sawai Mansingh Stadium", "Sawai Mansingh Stadium, Jaipur"],
  ["Wankhede Stadium", "Wankhede Stadium, Mumbai"],
];

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const group of VENUE_ALIASES) {
    const canonical = group[0];
    for (const name of group) m[name] = canonical;
  }
  return m;
})();

/** Map a venue name to its canonical form, collapsing known aliases. */
export function canonicalVenue(name: string): string {
  return ALIAS_TO_CANONICAL[name] ?? name;
}

/**
 * Return every alias of a venue name (including the input itself). Used to
 * widen SQL filters when matching by canonical name.
 */
export function venueAliases(name: string): string[] {
  const canonical = canonicalVenue(name);
  for (const group of VENUE_ALIASES) {
    if (group[0] === canonical) return [...group];
  }
  return [name];
}

/**
 * City lookup keyed by canonical stadium name. Cricsheet stores the city
 * inline in newer seasons (e.g. "Wankhede Stadium, Mumbai") but the older
 * IPL years (2008-2013) and many international venues come through as a
 * bare stadium name. Hand-curated so we can always show a city under the
 * stadium label, regardless of how the source happened to spell it.
 */
const VENUE_CITY: Record<string, string> = {
  // India
  "Arun Jaitley Stadium": "Delhi",
  "Barabati Stadium": "Cuttack",
  "Barsapara Cricket Stadium": "Guwahati",
  "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium": "Lucknow",
  "Brabourne Stadium": "Mumbai",
  "Dr DY Patil Sports Academy": "Navi Mumbai",
  "Dr. Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium": "Visakhapatnam",
  "Eden Gardens": "Kolkata",
  "Feroz Shah Kotla": "Delhi",
  "Green Park": "Kanpur",
  "Himachal Pradesh Cricket Association Stadium": "Dharamsala",
  "Holkar Cricket Stadium": "Indore",
  "JSCA International Stadium Complex": "Ranchi",
  "M Chinnaswamy Stadium": "Bengaluru",
  "MA Chidambaram Stadium": "Chennai",
  "Maharaja Yadavindra Singh International Cricket Stadium": "New Chandigarh",
  "Maharashtra Cricket Association Stadium": "Pune",
  "Narendra Modi Stadium": "Ahmedabad",
  "Nehru Stadium": "Kochi",
  "Punjab Cricket Association IS Bindra Stadium": "Mohali",
  "Punjab Cricket Association Stadium": "Mohali",
  "Rajiv Gandhi International Stadium": "Hyderabad",
  "Sardar Patel Stadium": "Ahmedabad",
  "Saurashtra Cricket Association Stadium": "Rajkot",
  "Sawai Mansingh Stadium": "Jaipur",
  "Shaheed Veer Narayan Singh International Stadium": "Raipur",
  "Subrata Roy Sahara Stadium": "Pune",
  "Wankhede Stadium": "Mumbai",
  // UAE
  "Dubai International Cricket Stadium": "Dubai",
  "Sharjah Cricket Stadium": "Sharjah",
  "Sheikh Zayed Stadium": "Abu Dhabi",
  "Zayed Cricket Stadium": "Abu Dhabi",
  // South Africa (2009 season)
  "Buffalo Park": "East London",
  "De Beers Diamond Oval": "Kimberley",
  "Kingsmead": "Durban",
  "New Wanderers Stadium": "Johannesburg",
  "Newlands": "Cape Town",
  "OUTsurance Oval": "Bloemfontein",
  "St George's Park": "Gqeberha",
  "SuperSport Park": "Centurion",
};

/**
 * Return the city for a venue, falling back to whatever sits after the
 * last comma in the source string (so unfamiliar venues still get *something*
 * reasonable), then to the empty string.
 */
export function venueCity(name: string): string {
  const canonical = canonicalVenue(name);
  const lookup = VENUE_CITY[canonical];
  if (lookup) return lookup;
  const idx = name.lastIndexOf(",");
  return idx === -1 ? "" : name.slice(idx + 1).trim();
}

/**
 * Return the stadium half of a venue string — everything before the last
 * comma — so the city tail (when present in the source) doesn't get
 * duplicated in the display alongside `venueCity()`.
 */
export function venueStadium(name: string): string {
  const canonical = canonicalVenue(name);
  const idx = canonical.lastIndexOf(",");
  return idx === -1 ? canonical.trim() : canonical.slice(0, idx).trim();
}
