export interface SectionInfo {
  name: string;
  lat: number;
  lon: number;
}

export const SECTION_DATA: Record<string, SectionInfo> = {
  // 1st Call District
  CT:  { name: 'Connecticut',           lat: 41.6,  lon: -72.7 },
  EMA: { name: 'Eastern Massachusetts', lat: 42.3,  lon: -71.0 },
  ME:  { name: 'Maine',                 lat: 45.4,  lon: -69.0 },
  NH:  { name: 'New Hampshire',         lat: 43.7,  lon: -71.5 },
  RI:  { name: 'Rhode Island',          lat: 41.7,  lon: -71.5 },
  VT:  { name: 'Vermont',               lat: 44.0,  lon: -72.7 },
  WMA: { name: 'Western Massachusetts', lat: 42.2,  lon: -72.7 },
  // 2nd Call District
  ENY: { name: 'Eastern New York',      lat: 42.6,  lon: -73.8 },
  NLI: { name: 'New York City-Long Island', lat: 40.7, lon: -73.5 },
  NNJ: { name: 'Northern New Jersey',   lat: 40.9,  lon: -74.2 },
  NNY: { name: 'Northern New York',     lat: 44.5,  lon: -75.5 },
  SNJ: { name: 'Southern New Jersey',   lat: 39.8,  lon: -74.9 },
  WNY: { name: 'Western New York',      lat: 42.9,  lon: -78.8 },
  // 3rd Call District
  DE:  { name: 'Delaware',              lat: 39.0,  lon: -75.5 },
  EPA: { name: 'Eastern Pennsylvania',  lat: 40.4,  lon: -75.4 },
  MDC: { name: 'Maryland-DC',           lat: 39.0,  lon: -77.0 },
  WPA: { name: 'Western Pennsylvania',  lat: 40.5,  lon: -79.5 },
  // 4th Call District
  AL:  { name: 'Alabama',               lat: 32.8,  lon: -86.8 },
  GA:  { name: 'Georgia',               lat: 32.7,  lon: -83.5 },
  KY:  { name: 'Kentucky',              lat: 37.5,  lon: -85.3 },
  NC:  { name: 'North Carolina',        lat: 35.5,  lon: -79.4 },
  NFL: { name: 'Northern Florida',      lat: 29.6,  lon: -82.4 },
  SFL: { name: 'Southern Florida',      lat: 25.8,  lon: -80.5 },
  SC:  { name: 'South Carolina',        lat: 33.8,  lon: -81.2 },
  TN:  { name: 'Tennessee',             lat: 35.9,  lon: -86.6 },
  VA:  { name: 'Virginia',              lat: 37.7,  lon: -78.6 },
  WCF: { name: 'West Central Florida',  lat: 28.1,  lon: -82.5 },
  PR:  { name: 'Puerto Rico',           lat: 18.2,  lon: -66.5 },
  VI:  { name: 'US Virgin Islands',     lat: 18.3,  lon: -64.9 },
  // 5th Call District
  AR:  { name: 'Arkansas',              lat: 34.8,  lon: -92.3 },
  LA:  { name: 'Louisiana',             lat: 30.9,  lon: -91.8 },
  MS:  { name: 'Mississippi',           lat: 32.7,  lon: -89.7 },
  NM:  { name: 'New Mexico',            lat: 34.3,  lon: -106.0 },
  NTX: { name: 'North Texas',           lat: 33.2,  lon: -97.0 },
  OK:  { name: 'Oklahoma',              lat: 35.5,  lon: -97.5 },
  STX: { name: 'South Texas',           lat: 29.4,  lon: -98.5 },
  WTX: { name: 'West Texas',            lat: 31.7,  lon: -102.0 },
  // 6th Call District
  EB:  { name: 'East Bay',              lat: 37.8,  lon: -122.2 },
  LAX: { name: 'Los Angeles',           lat: 34.1,  lon: -118.3 },
  ORG: { name: 'Orange',                lat: 33.7,  lon: -117.8 },
  SB:  { name: 'Santa Barbara',         lat: 34.7,  lon: -119.7 },
  SCV: { name: 'Santa Clara Valley',    lat: 37.3,  lon: -121.9 },
  SDG: { name: 'San Diego',             lat: 32.8,  lon: -117.2 },
  SF:  { name: 'San Francisco',         lat: 37.8,  lon: -122.4 },
  SJV: { name: 'San Joaquin Valley',    lat: 36.7,  lon: -119.8 },
  SV:  { name: 'Sacramento Valley',     lat: 38.6,  lon: -121.5 },
  PAC: { name: 'Pacific',               lat: 21.3,  lon: -157.8 },
  // 7th Call District
  AK:  { name: 'Alaska',                lat: 64.2,  lon: -153.0 },
  AZ:  { name: 'Arizona',               lat: 34.3,  lon: -111.1 },
  EWA: { name: 'Eastern Washington',    lat: 47.3,  lon: -119.0 },
  ID:  { name: 'Idaho',                 lat: 44.1,  lon: -114.7 },
  MT:  { name: 'Montana',               lat: 46.9,  lon: -110.4 },
  NV:  { name: 'Nevada',                lat: 39.9,  lon: -117.1 },
  OR:  { name: 'Oregon',                lat: 44.1,  lon: -120.5 },
  UT:  { name: 'Utah',                  lat: 39.4,  lon: -111.1 },
  WWA: { name: 'Western Washington',    lat: 47.6,  lon: -122.3 },
  WY:  { name: 'Wyoming',               lat: 43.1,  lon: -107.6 },
  // 8th Call District
  MI:  { name: 'Michigan',              lat: 44.2,  lon: -85.5 },
  OH:  { name: 'Ohio',                  lat: 40.4,  lon: -82.9 },
  WV:  { name: 'West Virginia',         lat: 38.6,  lon: -80.5 },
  // 9th Call District
  IL:  { name: 'Illinois',              lat: 40.0,  lon: -89.3 },
  IN:  { name: 'Indiana',               lat: 39.9,  lon: -86.3 },
  WI:  { name: 'Wisconsin',             lat: 44.5,  lon: -89.6 },
  // 0th Call District
  CO:  { name: 'Colorado',              lat: 39.1,  lon: -105.4 },
  IA:  { name: 'Iowa',                  lat: 42.0,  lon: -93.2 },
  KS:  { name: 'Kansas',                lat: 38.5,  lon: -98.4 },
  MN:  { name: 'Minnesota',             lat: 46.4,  lon: -94.6 },
  MO:  { name: 'Missouri',              lat: 38.5,  lon: -92.5 },
  ND:  { name: 'North Dakota',          lat: 47.5,  lon: -100.3 },
  NE:  { name: 'Nebraska',              lat: 41.5,  lon: -99.9 },
  SD:  { name: 'South Dakota',          lat: 44.4,  lon: -100.3 },
  // Canada (RAC sections)
  AB:  { name: 'Alberta',               lat: 53.9,  lon: -116.6 },
  BC:  { name: 'British Columbia',      lat: 53.7,  lon: -127.6 },
  GH:  { name: 'Golden Horseshoe',      lat: 43.5,  lon: -79.6 },
  MB:  { name: 'Manitoba',              lat: 53.8,  lon: -98.8 },
  NB:  { name: 'New Brunswick',         lat: 46.6,  lon: -66.5 },
  NL:  { name: 'Newfoundland/Labrador', lat: 53.1,  lon: -56.3 },
  NS:  { name: 'Nova Scotia',           lat: 44.7,  lon: -63.7 },
  // Yukon, Northwest Territories and Nunavut are one section, not three.
  NT:  { name: 'Northern Territories',  lat: 64.5,  lon: -115.0 },
  ONE: { name: 'Ontario East',          lat: 45.2,  lon: -76.4 },
  ONN: { name: 'Ontario North',         lat: 49.7,  lon: -87.0 },
  ONS: { name: 'Ontario South',         lat: 43.8,  lon: -81.3 },
  PE:  { name: 'Prince Edward Island',  lat: 46.4,  lon: -63.2 },
  QC:  { name: 'Quebec',                lat: 53.0,  lon: -71.6 },
  SK:  { name: 'Saskatchewan',          lat: 52.9,  lon: -106.5 },
};

/**
 * The call-area layout, used by every panel that shows sections as a grid.
 *
 * This lives here, once, because it used to live twice — SectionGrid and
 * SectionsNeeded each carried their own copy, and when the section list was
 * corrected only one of them was updated. The panel an operator reads to know
 * what to chase went on listing sections RAC had retired and omitting seven
 * real ones. Adding a third copy is the bug; there is no third copy to add.
 *
 * `label` is the call area, `title` is what a panel renders as its heading.
 */
export interface SectionGroup {
  label: string;
  title: string;
  sections: string[];
}

export const SECTION_GROUPS: SectionGroup[] = [
  { label: '1',      title: '1st District', sections: ['CT','EMA','ME','NH','RI','VT','WMA'] },
  { label: '2',      title: '2nd District', sections: ['ENY','NLI','NNJ','NNY','SNJ','WNY'] },
  { label: '3',      title: '3rd District', sections: ['DE','EPA','MDC','WPA'] },
  // Puerto Rico and the Virgin Islands sit in the Southeastern Division with
  // the rest of these, though their call areas (KP4/KP2) are their own.
  { label: '4',      title: '4th District', sections: ['AL','GA','KY','NC','NFL','PR','SC','SFL','TN','VA','VI','WCF'] },
  { label: '5',      title: '5th District', sections: ['AR','LA','MS','NM','NTX','OK','STX','WTX'] },
  { label: '6',      title: '6th District', sections: ['EB','LAX','ORG','PAC','SB','SCV','SDG','SF','SJV','SV'] },
  { label: '7',      title: '7th District', sections: ['AK','AZ','EWA','ID','MT','NV','OR','UT','WWA','WY'] },
  { label: '8',      title: '8th District', sections: ['MI','OH','WV'] },
  { label: '9',      title: '9th District', sections: ['IL','IN','WI'] },
  { label: '0',      title: '0th District', sections: ['CO','IA','KS','MN','MO','ND','NE','SD'] },
  { label: 'Canada', title: 'Canada',       sections: ['AB','BC','GH','MB','NB','NL','NS','NT','ONE','ONN','ONS','PE','QC','SK'] },
];
