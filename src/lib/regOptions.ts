export const AVAILABILITY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Earlies', 'Lates', 'Nights'];
export const TRANSPORT = ['Own car', 'Public transport', 'Lift from someone', 'Bike', 'Walk'];

/** Suggestions only: candidates can type any nationality. */
export const NATIONALITIES = ['British', 'Irish', 'Afghan', 'Albanian', 'Bangladeshi', 'Brazilian', 'Bulgarian', 'Chinese', 'Czech', 'Egyptian', 'Eritrean', 'Estonian',
  'Filipino', 'French', 'Ghanaian', 'German', 'Greek', 'Hungarian', 'Indian', 'Iranian', 'Iraqi', 'Italian', 'Jamaican', 'Kenyan', 'Kurdish', 'Latvian', 'Lithuanian',
  'Moldovan', 'Nepalese', 'Nigerian', 'Pakistani', 'Polish', 'Portuguese', 'Romanian', 'Russian', 'Slovak', 'Somali', 'South African', 'Spanish', 'Sri Lankan',
  'Sudanese', 'Syrian', 'Turkish', 'Ugandan', 'Ukrainian', 'Vietnamese', 'Zimbabwean'];

/** Driving licence categories we ask about, as DVLA codes with plain-English labels. */
export const LICENCE_CATEGORIES: [string, string][] = [
  ['B', 'B: car / small van'],
  ['BE', 'B+E: car with trailer'],
  ['C1', 'C1: 3.5 to 7.5 tonnes'],
  ['C1E', 'C1+E: 7.5t with trailer'],
  ['C', 'C: rigid HGV (Class 2)'],
  ['CE', 'C+E: artic HGV (Class 1)'],
  ['D1', 'D1: minibus'],
  ['D', 'D: bus or coach'],
];
export const licenceLabel = (code: string) => LICENCE_CATEGORIES.find(([c]) => c === code)?.[1].split(':')[0] ?? code;

/** UK driving licence number: 16 letters and numbers. */
export const cleanLicenceNo = (s: string) => (s || '').replace(/[\s-]+/g, '').toUpperCase();
export const licenceNoOk = (s: string) => /^[A-Z9]{5}\d{6}[A-Z0-9]{5}$/.test(cleanLicenceNo(s));
/** DVLA "share your licence" check code: 8 letters and numbers, and it IS case sensitive. */
export const cleanCheckCode = (s: string) => (s || '').replace(/[\s-]+/g, '');
export const checkCodeOk = (s: string) => /^[A-Za-z0-9]{8}$/.test(cleanCheckCode(s));
/** Check codes last 21 days. */
export const CHECK_CODE_DAYS = 21;
