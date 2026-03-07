export type MandatoryDocumentStatus = 'present' | 'missing' | 'needs_review';

interface MandatoryDocumentDefinition {
  code: string;
  name: string;
  keywords: string[];
  urlHints: string[];
  requiresExpiry: boolean;
  includeFacilityMetrics?: boolean;
}

export interface MandatoryDocumentAudit {
  code: string;
  name: string;
  status: MandatoryDocumentStatus;
  sourceUrl: string | null;
  expiryDate: string | null;
  details: Record<string, unknown>;
  reviewMessage: string | null;
  confidence: number;
}

const DISCLOSURE_SIGNAL_RX = /\b(mandatory\s*public\s*disclosure|mandatory\s*disclosure|public\s*disclosure|cbse\s*disclosure|appendix\s*ix)\b/i;

const MANDATORY_DOCUMENT_DEFINITIONS: MandatoryDocumentDefinition[] = [
  {
    code: 'mandatory_disclosure_details',
    name: 'Mandatory Disclosure Details',
    keywords: ['mandatory disclosure details', 'mandatory public disclosure', 'public disclosure', 'mandatory disclosure', 'appendix ix', 'saras', 'part a', 'part b'],
    urlHints: ['mandatory-disclosure', 'mandatory-public-disclosure', 'public-disclosure', 'appendix', 'saras'],
    requiresExpiry: false,
    includeFacilityMetrics: true,
  },
  {
    code: 'affiliation_certificate',
    name: 'Affiliation Certificate',
    keywords: ['affiliation certificate', 'cbse affiliation', 'affiliation no', 'affiliation letter'],
    urlHints: ['affiliation', 'cbse-affiliation'],
    requiresExpiry: true,
  },
  {
    code: 'society_trust_certificate',
    name: 'Society/Trust Registration Certificate',
    keywords: ['society registration', 'trust registration', 'registration certificate of society', 'society/trust'],
    urlHints: ['trust', 'society', 'registration'],
    requiresExpiry: false,
  },
  {
    code: 'state_noc',
    name: 'State Government NOC',
    keywords: ['noc issued by state', 'no objection certificate', 'state noc'],
    urlHints: ['noc', 'no-objection'],
    requiresExpiry: true,
  },
  {
    code: 'recognition_certificate',
    name: 'Recognition Certificate',
    keywords: ['recognition certificate', 'certificate of recognition'],
    urlHints: ['recognition'],
    requiresExpiry: true,
  },
  {
    code: 'building_safety_certificate',
    name: 'Building Safety Certificate',
    keywords: ['building safety certificate', 'building fitness', 'structural stability certificate'],
    urlHints: ['building-safety', 'structural', 'fitness-certificate'],
    requiresExpiry: true,
  },
  {
    code: 'fire_safety_certificate',
    name: 'Fire Safety Certificate',
    keywords: ['fire safety certificate', 'fire noc', 'fire certificate'],
    urlHints: ['fire', 'fire-noc'],
    requiresExpiry: true,
  },
  {
    code: 'water_sanitation_certificate',
    name: 'Water, Health and Sanitation Certificate',
    keywords: ['safe drinking water', 'health and sanitation', 'sanitary certificate', 'water and sanitation'],
    urlHints: ['sanitation', 'sanitary', 'water'],
    requiresExpiry: true,
  },
  {
    code: 'deo_certificate',
    name: 'DEO Certificate',
    keywords: ['deo certificate', 'district education officer', 'deo certifies'],
    urlHints: ['deo', 'district-education-officer'],
    requiresExpiry: true,
  },
  {
    code: 'fee_structure',
    name: 'Fee Structure',
    keywords: ['fee structure', 'annual fee', 'tuition fee'],
    urlHints: ['fee', 'fees'],
    requiresExpiry: false,
  },
  {
    code: 'annual_academic_calendar',
    name: 'Annual Academic Calendar',
    keywords: ['academic calendar', 'annual calendar', 'session plan'],
    urlHints: ['calendar', 'academic'],
    requiresExpiry: false,
  },
  {
    code: 'smc_details',
    name: 'SMC Details',
    keywords: ['school management committee', 'smc details', 'smc list'],
    urlHints: ['smc'],
    requiresExpiry: false,
  },
  {
    code: 'pta_details',
    name: 'PTA Details',
    keywords: ['pta members', 'parent teacher association', 'pta details'],
    urlHints: ['pta', 'parent-teacher'],
    requiresExpiry: false,
  },
  {
    code: 'result_class_x',
    name: 'Class X Board Results',
    keywords: ['class x result', 'class 10 result', 'board result class x'],
    urlHints: ['class-x', 'class-10', 'result'],
    requiresExpiry: false,
  },
  {
    code: 'result_class_xii',
    name: 'Class XII Board Results',
    keywords: ['class xii result', 'class 12 result', 'board result class xii'],
    urlHints: ['class-xii', 'class-12', 'result'],
    requiresExpiry: false,
  },
];

const STATUS_RANK: Record<MandatoryDocumentStatus, number> = {
  missing: 1,
  needs_review: 2,
  present: 3,
};

function uniqInts(values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isFinite(n) && n >= 0 && n <= 100000))];
}

function collectNumbers(text: string, patterns: RegExp[]): number[] {
  const all: number[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const value = Number(m[1]);
      if (!Number.isNaN(value)) all.push(value);
    }
  }
  return uniqInts(all);
}

function parseNumericField(
  text: string,
  label: string,
  patterns: RegExp[],
  details: Record<string, unknown>,
  issues: string[],
): void {
  const values = collectNumbers(text, patterns);
  if (values.length === 1) {
    details[label] = values[0];
  } else if (values.length > 1) {
    details[label] = values[0];
    issues.push(`Conflicting values found for ${label}: ${values.join(', ')}`);
  }
}

function parseFacilityMetrics(text: string): { details: Record<string, unknown>; issues: string[] } {
  const details: Record<string, unknown> = {};
  const issues: string[] = [];

  parseNumericField(text, 'totalTeachers', [
    /total\s+(?:number|no\.?)\s+of\s+teachers[^\d]{0,25}(\d{1,4})/gi,
    /teachers\s+total[^\d]{0,25}(\d{1,4})/gi,
  ], details, issues);
  parseNumericField(text, 'pgtCount', [/no\.?\s+of\s+pgt(?:s)?[^\d]{0,25}(\d{1,4})/gi], details, issues);
  parseNumericField(text, 'tgtCount', [/no\.?\s+of\s+tgt(?:s)?[^\d]{0,25}(\d{1,4})/gi], details, issues);
  parseNumericField(text, 'prtCount', [/no\.?\s+of\s+prt(?:s)?[^\d]{0,25}(\d{1,4})/gi], details, issues);
  parseNumericField(text, 'petCount', [/no\.?\s+of\s+pet(?:s)?[^\d]{0,25}(\d{1,4})/gi], details, issues);
  parseNumericField(text, 'nonTeachingStaffCount', [
    /non[-\s]?teaching\s+staff[^\d]{0,25}(\d{1,4})/gi,
    /no\.?\s+of\s+non[-\s]?teaching[^\d]{0,25}(\d{1,4})/gi,
  ], details, issues);

  parseNumericField(text, 'girlsToilets', [
    /girls'?\s+toilets?[^\d]{0,25}(\d{1,4})/gi,
    /toilets?\s+for\s+girls[^\d]{0,25}(\d{1,4})/gi,
  ], details, issues);
  parseNumericField(text, 'boysToilets', [
    /boys'?\s+toilets?[^\d]{0,25}(\d{1,4})/gi,
    /toilets?\s+for\s+boys[^\d]{0,25}(\d{1,4})/gi,
  ], details, issues);
  parseNumericField(text, 'cwsnToilets', [
    /cwsn\s+friendly\s+toilets?[^\d]{0,25}(\d{1,4})/gi,
    /toilets?\s+for\s+cwsn[^\d]{0,25}(\d{1,4})/gi,
  ], details, issues);
  parseNumericField(text, 'totalToilets', [
    /total\s+(?:number|no\.?)\s+of\s+toilets?[^\d]{0,25}(\d{1,4})/gi,
  ], details, issues);

  return { details, issues };
}

function scoreDocument(def: MandatoryDocumentDefinition, lowerText: string, lowerUrl: string): number {
  let score = 0;
  for (const k of def.keywords) {
    if (lowerText.includes(k.toLowerCase())) score += 2;
  }
  for (const k of def.urlHints) {
    if (lowerUrl.includes(k.toLowerCase())) score += 3;
  }
  return score;
}

function scoreDocumentFromSignals(def: MandatoryDocumentDefinition, signalText: string, signalUrl: string): number {
  const lowerText = signalText.toLowerCase();
  const lowerUrl = signalUrl.toLowerCase();
  return scoreDocument(def, lowerText, lowerUrl);
}

function asMonthNumber(token: string): number | null {
  const months: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  return months[token.toLowerCase()] ?? null;
}

function toIsoDate(dayRaw: string, monthRaw: string, yearRaw: string): string | null {
  const day = Number(dayRaw);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  let month: number | null = null;
  if (/^\d+$/.test(monthRaw)) {
    month = Number(monthRaw);
  } else {
    month = asMonthNumber(monthRaw);
  }
  if (!month || month < 1 || month > 12) return null;

  let year = Number(yearRaw);
  if (!Number.isInteger(year)) return null;
  if (yearRaw.length === 2) year = 2000 + year;
  if (year < 2000 || year > 2100) return null;

  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}

function parseDateToken(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const numeric = cleaned.match(/^([0-3]?\d)[\/\-.]([01]?\d)[\/\-.](\d{2,4})$/);
  if (numeric) return toIsoDate(numeric[1], numeric[2], numeric[3]);

  const alpha = cleaned.match(/^([0-3]?\d)\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (alpha) return toIsoDate(alpha[1], alpha[2], alpha[3]);

  return null;
}

function extractExpiryDate(text: string): string | null {
  const candidates: string[] = [];

  const contextual = [
    /(?:valid(?:ity)?\s*(?:up to|upto|till|until)|expiry(?:\s*date)?|expires?\s*on)\s*[:\-]?\s*([0-3]?\d[\/\-.][01]?\d[\/\-.]\d{2,4})/gi,
    /(?:valid(?:ity)?\s*(?:up to|upto|till|until)|expiry(?:\s*date)?|expires?\s*on)\s*[:\-]?\s*([0-3]?\d\s+[A-Za-z]{3,9}\s+\d{2,4})/gi,
  ];

  for (const rx of contextual) {
    for (const m of text.matchAll(rx)) {
      if (m[1]) candidates.push(m[1]);
    }
  }

  for (const raw of candidates) {
    const parsed = parseDateToken(raw);
    if (parsed) return parsed;
  }

  return null;
}

function pickDocumentDefinition(url: string, text: string): { def: MandatoryDocumentDefinition; score: number } | null {
  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();

  let best: { def: MandatoryDocumentDefinition; score: number } | null = null;
  for (const def of MANDATORY_DOCUMENT_DEFINITIONS) {
    const score = scoreDocument(def, lowerText, lowerUrl);
    if (!best || score > best.score) best = { def, score };
  }
  if (!best || best.score < 3) return null;
  return best;
}

export function analyzeMandatoryPdf(url: string, text: string): MandatoryDocumentAudit | null {
  const hit = pickDocumentDefinition(url, text);
  if (!hit) return null;

  const review: string[] = [];
  const details: Record<string, unknown> = {};
  let status: MandatoryDocumentStatus = 'present';
  const expiryDate = extractExpiryDate(text);

  if (text.length < 150) {
    status = 'needs_review';
    review.push('PDF text extraction was too short; manual verification required.');
  }

  if (hit.def.requiresExpiry && !expiryDate) {
    status = 'needs_review';
    review.push('Expiry date not detected in this PDF.');
  }

  if (hit.def.includeFacilityMetrics) {
    const facility = parseFacilityMetrics(text);
    Object.assign(details, facility.details);
    if (facility.issues.length > 0) {
      status = 'needs_review';
      review.push(...facility.issues);
    }
  }

  const confidence = Math.max(30, Math.min(95, (hit.score * 8) + (status === 'present' ? 20 : 0)));
  return {
    code: hit.def.code,
    name: hit.def.name,
    status,
    sourceUrl: url,
    expiryDate: expiryDate || null,
    details,
    reviewMessage: review.length ? review.slice(0, 3).join(' ') : null,
    confidence,
  };
}

export function inferMandatoryDocFromUrl(url: string): MandatoryDocumentAudit | null {
  const hit = pickDocumentDefinition(url, '');
  if (!hit) return null;
  return {
    code: hit.def.code,
    name: hit.def.name,
    status: 'needs_review',
    sourceUrl: url,
    expiryDate: null,
    details: {},
    reviewMessage: 'Document link found, but PDF text could not be extracted. Manual review needed.',
    confidence: Math.max(30, Math.min(80, hit.score * 8)),
  };
}

export function inferMandatoryDocFromSignal(signalText: string, signalUrl: string): MandatoryDocumentAudit | null {
  const text = signalText || '';
  const url = signalUrl || '';
  let best: { def: MandatoryDocumentDefinition; score: number } | null = null;
  for (const def of MANDATORY_DOCUMENT_DEFINITIONS) {
    const score = scoreDocumentFromSignals(def, text, url);
    if (!best || score > best.score) best = { def, score };
  }

  const disclosureSignal = DISCLOSURE_SIGNAL_RX.test(`${text} ${url}`);
  if ((!best || best.score < 2) && !disclosureSignal) return null;

  const fallbackDef = best?.def || MANDATORY_DOCUMENT_DEFINITIONS[0];
  const confidenceFromScore = best ? Math.max(35, Math.min(80, best.score * 10)) : 40;
  return {
    code: fallbackDef.code,
    name: fallbackDef.name,
    status: 'needs_review',
    sourceUrl: signalUrl || null,
    expiryDate: null,
    details: {},
    reviewMessage: 'Disclosure item found, but the link needs manual verification.',
    confidence: confidenceFromScore,
  };
}

export function buildMissingMandatoryDocuments(
  foundCodes: Set<string>,
  options?: { homepageDisclosureLinkFound?: boolean },
): MandatoryDocumentAudit[] {
  const homepageDisclosureLinkFound = options?.homepageDisclosureLinkFound ?? true;
  const missingMessage = homepageDisclosureLinkFound
    ? 'Document not found in crawled mandatory disclosure PDFs.'
    : 'Document not found. CBSE expects a "Mandatory Disclosure" link on the homepage.';
  return MANDATORY_DOCUMENT_DEFINITIONS
    .filter((d) => !foundCodes.has(d.code))
    .map((d) => ({
      code: d.code,
      name: d.name,
      status: 'missing' as const,
      sourceUrl: null,
      expiryDate: null,
      details: {},
      reviewMessage: missingMessage,
      confidence: 100,
    }));
}

export function mergeMandatoryDocumentAudit(
  current: MandatoryDocumentAudit | undefined,
  candidate: MandatoryDocumentAudit,
): MandatoryDocumentAudit {
  if (!current) return candidate;
  const currentRank = STATUS_RANK[current.status];
  const candidateRank = STATUS_RANK[candidate.status];
  if (candidateRank > currentRank) return candidate;
  if (candidateRank < currentRank) return current;

  if (candidate.confidence > current.confidence) return candidate;
  const currentDetailsCount = Object.keys(current.details || {}).length;
  const candidateDetailsCount = Object.keys(candidate.details || {}).length;
  if (candidateDetailsCount > currentDetailsCount) return candidate;
  if (!current.expiryDate && candidate.expiryDate) return candidate;
  return current;
}
