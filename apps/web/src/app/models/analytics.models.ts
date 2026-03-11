export interface AnalyticsTotals {
  totalScanRuns: number;
  completedScans: number;
  successfulScans: number;
  rejectedScans: number;
  failedScans: number;
  uniqueSchoolsCrawled: number;
  schoolsCrawledList: Array<{
    name: string;
    website: string;
    lastCrawledAt: string | null;
  }>;
}

export interface AnalyticsCrawlTime {
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  perDay: Array<{
    day: string;
    averageMs: number;
    runCount: number;
  }>;
  slowestSchools: Array<{
    sessionId: string;
    schoolName: string;
    url: string;
    durationMs: number;
    completedAt: string | null;
  }>;
}

export interface AnalyticsUsers {
  newUsers: number | null;
  returningUsers: number | null;
  note: string;
}

export interface AnalyticsComparisons {
  compareListsCreated: number;
  comparisonsDone: number;
  schoolsAddedToCompare: number;
  mostComparedSchools: Array<{
    schoolName: string;
    website: string;
    compareAdds: number;
  }>;
}

export interface AnalyticsQuestions {
  totalQuestionsAsked: number;
  questionsPerScan: number;
  completedScanQuestionRatePercent: number;
  perDay: Array<{
    day: string;
    questions: number;
  }>;
  bySchool: Array<{
    schoolName: string;
    website: string;
    totalQuestions: number;
  }>;
  latest: Array<{
    askedAt: string;
    schoolName: string;
    question: string;
  }>;
}

export interface AnalyticsPopularity {
  mostScannedSchools: Array<{
    schoolName: string;
    website: string;
    scans: number;
  }>;
  topSchoolCounters: Array<{
    schoolName: string;
    website: string;
    viewCount: number;
    compareCount: number;
    searchCount: number;
  }>;
  countersReliabilityNote: string;
}

export interface AnalyticsB2b {
  totalCtaClicks: number;
  uniqueCtaSessions: number;
  conversionPercent: number;
}

export interface AnalyticsOverviewResponse {
  generatedAt: string;
  totals: AnalyticsTotals;
  crawlTime: AnalyticsCrawlTime;
  users: AnalyticsUsers;
  comparisons: AnalyticsComparisons;
  questions: AnalyticsQuestions;
  popularity: AnalyticsPopularity;
  b2b: AnalyticsB2b;
}
