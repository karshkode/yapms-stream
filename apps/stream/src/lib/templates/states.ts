/**
 * US state metadata used by every template and by the race picker search
 * index. FIPS codes match the `action-groups` attribute in
 * apps/yapms/src/lib/assets/maps/usa/usa-counties-2023-blank.svg — so a
 * filterValue of e.g. '39' carves Ohio out of the national county map.
 */

export interface StateMeta {
	fips: string;
	abbr: string; // two-letter, uppercase
	abbrLower: string; // two-letter, lowercase (matches yapms SVG filename segment)
	name: string;
}

export const STATES: StateMeta[] = [
	{ fips: '01', abbr: 'AL', abbrLower: 'al', name: 'Alabama' },
	{ fips: '02', abbr: 'AK', abbrLower: 'ak', name: 'Alaska' },
	{ fips: '04', abbr: 'AZ', abbrLower: 'az', name: 'Arizona' },
	{ fips: '05', abbr: 'AR', abbrLower: 'ar', name: 'Arkansas' },
	{ fips: '06', abbr: 'CA', abbrLower: 'ca', name: 'California' },
	{ fips: '08', abbr: 'CO', abbrLower: 'co', name: 'Colorado' },
	{ fips: '09', abbr: 'CT', abbrLower: 'ct', name: 'Connecticut' },
	{ fips: '10', abbr: 'DE', abbrLower: 'de', name: 'Delaware' },
	{ fips: '11', abbr: 'DC', abbrLower: 'dc', name: 'District of Columbia' },
	{ fips: '12', abbr: 'FL', abbrLower: 'fl', name: 'Florida' },
	{ fips: '13', abbr: 'GA', abbrLower: 'ga', name: 'Georgia' },
	{ fips: '15', abbr: 'HI', abbrLower: 'hi', name: 'Hawaii' },
	{ fips: '16', abbr: 'ID', abbrLower: 'id', name: 'Idaho' },
	{ fips: '17', abbr: 'IL', abbrLower: 'il', name: 'Illinois' },
	{ fips: '18', abbr: 'IN', abbrLower: 'in', name: 'Indiana' },
	{ fips: '19', abbr: 'IA', abbrLower: 'ia', name: 'Iowa' },
	{ fips: '20', abbr: 'KS', abbrLower: 'ks', name: 'Kansas' },
	{ fips: '21', abbr: 'KY', abbrLower: 'ky', name: 'Kentucky' },
	{ fips: '22', abbr: 'LA', abbrLower: 'la', name: 'Louisiana' },
	{ fips: '23', abbr: 'ME', abbrLower: 'me', name: 'Maine' },
	{ fips: '24', abbr: 'MD', abbrLower: 'md', name: 'Maryland' },
	{ fips: '25', abbr: 'MA', abbrLower: 'ma', name: 'Massachusetts' },
	{ fips: '26', abbr: 'MI', abbrLower: 'mi', name: 'Michigan' },
	{ fips: '27', abbr: 'MN', abbrLower: 'mn', name: 'Minnesota' },
	{ fips: '28', abbr: 'MS', abbrLower: 'ms', name: 'Mississippi' },
	{ fips: '29', abbr: 'MO', abbrLower: 'mo', name: 'Missouri' },
	{ fips: '30', abbr: 'MT', abbrLower: 'mt', name: 'Montana' },
	{ fips: '31', abbr: 'NE', abbrLower: 'ne', name: 'Nebraska' },
	{ fips: '32', abbr: 'NV', abbrLower: 'nv', name: 'Nevada' },
	{ fips: '33', abbr: 'NH', abbrLower: 'nh', name: 'New Hampshire' },
	{ fips: '34', abbr: 'NJ', abbrLower: 'nj', name: 'New Jersey' },
	{ fips: '35', abbr: 'NM', abbrLower: 'nm', name: 'New Mexico' },
	{ fips: '36', abbr: 'NY', abbrLower: 'ny', name: 'New York' },
	{ fips: '37', abbr: 'NC', abbrLower: 'nc', name: 'North Carolina' },
	{ fips: '38', abbr: 'ND', abbrLower: 'nd', name: 'North Dakota' },
	{ fips: '39', abbr: 'OH', abbrLower: 'oh', name: 'Ohio' },
	{ fips: '40', abbr: 'OK', abbrLower: 'ok', name: 'Oklahoma' },
	{ fips: '41', abbr: 'OR', abbrLower: 'or', name: 'Oregon' },
	{ fips: '42', abbr: 'PA', abbrLower: 'pa', name: 'Pennsylvania' },
	{ fips: '44', abbr: 'RI', abbrLower: 'ri', name: 'Rhode Island' },
	{ fips: '45', abbr: 'SC', abbrLower: 'sc', name: 'South Carolina' },
	{ fips: '46', abbr: 'SD', abbrLower: 'sd', name: 'South Dakota' },
	{ fips: '47', abbr: 'TN', abbrLower: 'tn', name: 'Tennessee' },
	{ fips: '48', abbr: 'TX', abbrLower: 'tx', name: 'Texas' },
	{ fips: '49', abbr: 'UT', abbrLower: 'ut', name: 'Utah' },
	{ fips: '50', abbr: 'VT', abbrLower: 'vt', name: 'Vermont' },
	{ fips: '51', abbr: 'VA', abbrLower: 'va', name: 'Virginia' },
	{ fips: '53', abbr: 'WA', abbrLower: 'wa', name: 'Washington' },
	{ fips: '54', abbr: 'WV', abbrLower: 'wv', name: 'West Virginia' },
	{ fips: '55', abbr: 'WI', abbrLower: 'wi', name: 'Wisconsin' },
	{ fips: '56', abbr: 'WY', abbrLower: 'wy', name: 'Wyoming' }
];

export const STATES_BY_FIPS: Record<string, StateMeta> = Object.fromEntries(
	STATES.map((s) => [s.fips, s])
);

export const STATES_BY_ABBR: Record<string, StateMeta> = Object.fromEntries(
	STATES.map((s) => [s.abbr, s])
);
