/* ------------------------------------------------------------------ */
/*  SchoolLens API response types                                      */
/* ------------------------------------------------------------------ */

export type ScanStatus = 'Classifying' | 'Crawling' | 'Scoring' | 'Ready' | 'Rejected' | 'Uncertain' | 'Failed' | 'Error';
export type TransparencyLevel = 'Low' | 'Moderate' | 'High';

export interface SchoolIdentity {
  name: string;
  board: string | null;
  websiteUrl: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  principal: string | null;
  foundingYear?: string | null;
  vision?: string | null;
  mission?: string | null;
  motto?: string | null;
  socialUrls?: { facebook?: string; instagram?: string; youtube?: string; twitter?: string; linkedin?: string } | null;
}

export interface ParentQuestion {
  icon: string;
  text: string;
}

export function getTransparencyLevel(score: number): TransparencyLevel {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

export function getTransparencyColor(level: TransparencyLevel): string {
  switch (level) {
    case 'High': return '#2e7d32';
    case 'Moderate': return '#e65100';
    case 'Low': return '#c62828';
  }
}

export interface Classification {
  isEducational: boolean;
  confidence: number;
  matchedKeywords?: string[];
  missingIndicators?: string[];
  rejectionReasons?: string[];
}

export interface CrawlSummary {
  pagesScanned: number;
  pdfsScanned: number;
  imagesScanned: number;
  depthReached: number;
  structuredDataDetected: boolean;
  scanTimeSeconds: number | null;
  scanConfidence: number | null;
  scanConfidenceLabel: string | null;
}

export interface SafetyItem {
  status: 'found' | 'missing' | 'unclear';
  evidence: string | null;
}

export interface SafetyScore {
  total: number;
  badge: 'verified' | 'partial' | 'not_found';
  items: {
    fireCertificate: SafetyItem;
    sanitaryCertificate: SafetyItem;
    cctvMention: SafetyItem;
    transportSafety: SafetyItem;
    antiBullyingPolicy: SafetyItem;
  };
}

export interface ClarityScore {
  total: number;
  label: string;
  note: string | null;
  items: {
    admissionDatesVisible: boolean;
    feeClarity: boolean;
    academicCalendar: boolean;
    contactAndMap: boolean;
    resultsPublished: boolean;
  };
}

export interface EarlyIdentity {
  schoolName?: string;
  principalName?: string;
  foundingYear?: string;
  vision?: string;
  mission?: string;
  motto?: string;
  visionConfidence?: 'high' | 'medium' | 'low';
  missionConfidence?: 'high' | 'medium' | 'low';
  mottoConfidence?: 'high' | 'medium' | 'low';
  socialUrls?: { facebook?: string; instagram?: string; youtube?: string; twitter?: string; linkedin?: string };
  phone?: string;
  email?: string;
  address?: string;
}

export interface ScanResponse {
  sessionId: string;
  url: string;
  status: ScanStatus;
  createdAt?: string;
  completedAt?: string;

  // Classification
  classification?: Classification;
  message?: string; // only when Rejected / Uncertain

  // Early identity (homepage-extracted, available during Crawling)
  earlyIdentity?: EarlyIdentity;

  // Crawl summary
  crawlSummary?: CrawlSummary;

  // Scores (only when Ready)
  overallScore?: number;
  summary?: string;
  safetyScore?: SafetyScore;
  clarityScore?: ClarityScore;

  // Scan submit response extras
  cached?: boolean;
  session?: { id: string; status: string; overall_score?: number; summary?: string };
}

export interface AskResponse {
  answer: string;
  citations: { pageUrl: string; excerpt: string }[];
}

export interface B2bInterestResponse {
  ok: boolean;
  ctaUrl: string;
}

/* ------------------------------------------------------------------ */
/*  SSE streaming types (Crawler V2)                                   */
/* ------------------------------------------------------------------ */

export type SSEEventType =
  | 'discovery_start' | 'discovery_complete'
  | 'page_crawled' | 'early_stop'
  | 'identity'
  | 'preliminary_score'
  | 'crawl_complete'
  | 'scoring_start' | 'final_score'
  | 'complete' | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

export interface CrawlFact {
  key: string;
  value: string;
  confidence: number;
  sourceUrl: string;
  sourceType: string;
  evidence?: string;
}

export interface PreliminaryScore {
  safety: number;
  clarity: number;
  overall: number;
}

export interface RedFlag {
  severity: 'high' | 'medium';
  flag: string;
  reason: string;
}

export interface RedFlagsResponse {
  sessionId: string;
  flags: RedFlag[];
  generatedAt: string;
  fromCache: boolean;
}
