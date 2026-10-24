/**
 * Generates a synthetic legacy household/person register with the problems real exports have:
 * Preeti-encoded names, mixed BS date formats, Devanagari digits (UTF-8 output only), old VDC
 * names, invalid wards and planted duplicates. Every value is synthetic.
 *
 * Usage: npm run generate:data -- --rows 1000 --seed 42 --encoding cp1252
 * Writes <out>.<encoding>.csv and <out>.<encoding>.truth.json (which rows carry which problem).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

export type Encoding = 'cp1252' | 'utf8';
export type AnomalyKind =
  'missing_dob' | 'impossible_dob' | 'ad_dob' | 'invalid_ward' | 'bad_citizenship';

export type Truth = {
  seed: number;
  encoding: Encoding;
  rows: number;
  anomalies: { row: number; kind: AnomalyKind }[];
  duplicates: { row: number; duplicateOf: number }[];
};

export type GeneratedRegister = {
  header: string[];
  rows: string[][];
  csv: string;
  truth: Truth;
};

type Name = { en: string; variant: string; ne: string; preeti: string };

// Preeti draws Devanagari glyphs on Latin keys, so its text is plain ASCII. The vowel sign ि is
// typed before its consonant (as it is drawn), e.g. सरिता = ;l/tf.
export const MALE: Name[] = [
  { en: 'Ram', variant: 'Raam', ne: 'राम', preeti: '/fd' },
  { en: 'Hari', variant: 'Harri', ne: 'हरि', preeti: 'xl/' },
  { en: 'Shyam', variant: 'Syam', ne: 'श्याम', preeti: 'Zofd' },
  { en: 'Kamal', variant: 'Kamall', ne: 'कमल', preeti: 'sdn' },
  { en: 'Dipak', variant: 'Deepak', ne: 'दीपक', preeti: 'bLks' },
];
export const FEMALE: Name[] = [
  { en: 'Sita', variant: 'Seeta', ne: 'सीता', preeti: ';Ltf' },
  { en: 'Gita', variant: 'Geeta', ne: 'गीता', preeti: 'uLtf' },
  { en: 'Maya', variant: 'Maaya', ne: 'माया', preeti: 'dfof' },
  { en: 'Sarita', variant: 'Saritaa', ne: 'सरिता', preeti: ';l/tf' },
  { en: 'Bimala', variant: 'Bimla', ne: 'बिमला', preeti: 'ladnf' },
];
export const SURNAMES: Name[] = [
  { en: 'Thapa', variant: 'Thappa', ne: 'थापा', preeti: 'yfkf' },
  { en: 'Magar', variant: 'Magarr', ne: 'मगर', preeti: 'du/' },
  { en: 'Shah', variant: 'Sah', ne: 'शाह', preeti: 'zfx' },
  { en: 'Khanal', variant: 'Khanaal', ne: 'खनाल', preeti: 'vgfn' },
  { en: 'Baral', variant: 'Barral', ne: 'बराल', preeti: 'a/fn' },
];

// Village Development Committees as they existed before the 2017 local-unit restructuring.
const DISTRICTS = [
  { name: 'Kaski', vdcs: ['Hemja', 'Sarangkot', 'Bhalam', 'Dhikurpokhari'] },
  { name: 'Chitwan', vdcs: ['Mangalpur', 'Gitanagar', 'Patihani'] },
  { name: 'Kathmandu', vdcs: ['Sitapaila', 'Dahachok', 'Gokarna'] },
];

// The curly quotes and en dash only exist in Windows-1252's 0x80-0x9F range: a decoder that
// assumes Latin-1 or UTF-8 will garble them.
const TOLES = ['Naya Bazar', 'Shanti Tole', 'Bagar', '‘Shanti’ Tole', 'Naya Bazar – Line 2'];
const GENDER_SPELLINGS = { M: ['M', 'Male', 'Purush', 'm'], F: ['F', 'Female', 'Mahila', 'f'] };
const DATE_FORMATS = ['YYYY/M/D', 'YYYY-MM-DD', 'D/M/YYYY', 'YYYY.MM.DD'] as const;
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const HEADER = [
  'SN',
  'GHAR_NO',
  'NAAM',
  'NAAM_EN',
  'LINGA',
  'JANMA_MITI',
  'BABU_NAAM',
  'NAGARIKTA_NO',
  'JILLA',
  'GABISA',
  'WARD_NO',
  'TOLE',
];

const DUPLICATE_RATE = 0.05;

type Person = {
  household: number;
  given: Name;
  surname: Name;
  gender: 'M' | 'F';
  father: Name;
  dob: { y: number; m: number; d: number };
  citizenship: string;
  district: string;
  vdc: string;
  ward: number;
  tole: string;
};

/** mulberry32: small, fast, deterministic for a given seed. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error('pick() from an empty list');
    return item;
  };
  return { next, int, pick, chance: (p: number): boolean => next() < p };
}

type Random = ReturnType<typeof createRandom>;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const toDevanagari = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit);

function createPerson(rng: Random, household: number, head: Person | undefined): Person {
  const gender = rng.chance(head ? 0.5 : 0.7) ? 'M' : 'F';
  const district = head ? { name: head.district, vdcs: [head.vdc] } : rng.pick(DISTRICTS);
  // BS years: heads are adults, other members any age. Days stop at 29 because every BS month
  // has at least 29 days, so only the deliberately impossible dates are invalid.
  const dob = {
    y: head ? rng.int(2015, 2075) : rng.int(2010, 2050),
    m: rng.int(1, 12),
    d: rng.int(1, 29),
  };
  const hasCitizenship = dob.y <= 2058 && rng.chance(0.85);
  return {
    household,
    given: rng.pick(gender === 'M' ? MALE : FEMALE),
    surname: head?.surname ?? rng.pick(SURNAMES),
    gender,
    father: rng.pick(MALE),
    dob,
    // The first segment is 80-99, outside Nepal's 77 district codes, so no number can be real.
    citizenship: hasCitizenship
      ? `${rng.int(80, 99)}-${pad(rng.int(1, 99))}-${pad(rng.int(40, 80))}-${pad(rng.int(1, 99999), 5)}`
      : '',
    district: district.name,
    vdc: head?.vdc ?? rng.pick(district.vdcs),
    ward: head?.ward ?? rng.int(1, 9),
    tole: head?.tole ?? rng.pick(TOLES),
  };
}

function formatDate({ y, m, d }: Person['dob'], format: (typeof DATE_FORMATS)[number]): string {
  switch (format) {
    case 'YYYY/M/D':
      return `${y}/${m}/${d}`;
    case 'YYYY-MM-DD':
      return `${y}-${pad(m)}-${pad(d)}`;
    case 'D/M/YYYY':
      return `${d}/${m}/${y}`;
    case 'YYYY.MM.DD':
      return `${y}.${pad(m)}.${pad(d)}`;
  }
}

function renderRow(
  rng: Random,
  sn: number,
  person: Person,
  encoding: Encoding,
  spellingVariant: boolean,
  anomalies: Truth['anomalies'],
): string[] {
  const nepali = (name: Name): string => (encoding === 'utf8' ? name.ne : name.preeti);
  // Always draw, so both encodings consume the same random stream and hold the same people.
  const digits = (text: string, p: number): string => {
    const devanagari = rng.chance(p);
    return encoding === 'utf8' && devanagari ? toDevanagari(text) : text;
  };
  const flag = (kind: AnomalyKind): void => {
    anomalies.push({ row: sn, kind });
  };

  let nameEn = spellingVariant
    ? `${person.given.variant} ${person.surname.variant}`
    : `${person.given.en} ${person.surname.en}`;
  if (rng.chance(0.15)) nameEn = nameEn.toUpperCase();
  else if (rng.chance(0.1)) nameEn = `  ${nameEn.toLowerCase()} `;

  let dob: string;
  const roll = rng.next();
  if (roll < 0.03) {
    dob = '';
    flag('missing_dob');
  } else if (roll < 0.06) {
    dob = rng.chance(0.5)
      ? `${person.dob.y}/13/${person.dob.d}`
      : `${person.dob.y}/${person.dob.m}/33`;
    flag('impossible_dob');
  } else if (roll < 0.08) {
    // Clerk typed the AD date into a BS field (AD is about 57 years behind BS).
    dob = `${person.dob.y - 57}-${pad(person.dob.m)}-${pad(person.dob.d)}`;
    flag('ad_dob');
  } else {
    dob = digits(formatDate(person.dob, rng.pick(DATE_FORMATS)), 0.3);
  }

  let citizenship = person.citizenship;
  if (citizenship && rng.chance(0.03)) {
    citizenship = rng.chance(0.5) ? citizenship.slice(0, 8) : citizenship.replace(/0/g, 'O');
    if (citizenship !== person.citizenship) flag('bad_citizenship');
  }

  let ward = String(person.ward);
  if (rng.chance(0.05)) {
    ward = String(rng.chance(0.3) ? 0 : rng.int(10, 35));
    flag('invalid_ward');
  }

  const vdcStyles = [
    person.vdc,
    person.vdc.toUpperCase(),
    `${person.vdc} VDC`,
    `${person.vdc} Gabisa`,
    `${person.vdc} `,
  ];

  return [
    String(sn),
    String(person.household),
    `${nepali(person.given)} ${nepali(person.surname)}`,
    nameEn,
    rng.pick(GENDER_SPELLINGS[person.gender]),
    dob,
    `${nepali(person.father)} ${nepali(person.surname)}`,
    citizenship,
    rng.chance(0.2) ? person.district.toUpperCase() : person.district,
    rng.pick(vdcStyles),
    digits(ward, 0.25),
    person.tole,
  ];
}

function toCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function generateRegister(options: {
  rows: number;
  seed: number;
  encoding: Encoding;
}): GeneratedRegister {
  const rng = createRandom(options.seed);
  const truth: Truth = { ...options, anomalies: [], duplicates: [] };
  const rows: string[][] = [];
  const people: { sn: number; person: Person }[] = [];

  let household = 0;
  let pending: Person[] = [];
  while (rows.length < options.rows) {
    const sn = rows.length + 1;
    const original = people.length > 3 && rng.chance(DUPLICATE_RATE) ? rng.pick(people) : undefined;
    if (original) {
      rows.push(renderRow(rng, sn, original.person, options.encoding, true, truth.anomalies));
      truth.duplicates.push({ row: sn, duplicateOf: original.sn });
      continue;
    }
    if (pending.length === 0) {
      household += 1;
      const head = createPerson(rng, household, undefined);
      const size = rng.int(1, 5);
      pending = [head];
      for (let i = 1; i < size; i++) pending.push(createPerson(rng, household, head));
    }
    const person = pending.shift() as Person;
    rows.push(renderRow(rng, sn, person, options.encoding, false, truth.anomalies));
    people.push({ sn, person });
  }

  // Legacy Windows exports use CRLF line endings.
  const csv = [HEADER, ...rows].map((r) => r.map(toCsvField).join(',')).join('\r\n') + '\r\n';
  return { header: HEADER, rows, csv, truth };
}

// Windows-1252 matches Latin-1 except 0x80-0x9F, which holds these characters instead.
const CP1252_HIGH: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

export function encodeCp1252(text: string): Buffer {
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    const code = text.charCodeAt(i);
    const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252_HIGH[char];
    if (byte === undefined) {
      throw new Error(
        `Character U+${code.toString(16).toUpperCase()} cannot be encoded in Windows-1252`,
      );
    }
    bytes[i] = byte;
  }
  return bytes;
}

const cliSchema = z.object({
  rows: z.coerce.number().int().min(1).max(1_000_000),
  seed: z.coerce.number().int().min(0),
  encoding: z.enum(['cp1252', 'utf8']),
  out: z.string().min(1),
});

function main(): void {
  const { values } = parseArgs({
    options: {
      rows: { type: 'string', default: '1000' },
      seed: { type: 'string', default: '42' },
      encoding: { type: 'string', default: 'cp1252' },
      out: { type: 'string', default: 'test/fixtures/generated/register' },
    },
  });
  const args = cliSchema.parse(values);
  const register = generateRegister(args);
  const base = `${args.out}.${args.encoding}`;

  mkdirSync(dirname(base), { recursive: true });
  const bytes =
    args.encoding === 'cp1252' ? encodeCp1252(register.csv) : Buffer.from(register.csv, 'utf8');
  writeFileSync(`${base}.csv`, bytes);
  writeFileSync(`${base}.truth.json`, JSON.stringify(register.truth, null, 2) + '\n');
  console.log(
    `wrote ${base}.csv: ${args.rows} rows, ${register.truth.anomalies.length} anomalies, ` +
      `${register.truth.duplicates.length} duplicates`,
  );
}

if (require.main === module) main();
