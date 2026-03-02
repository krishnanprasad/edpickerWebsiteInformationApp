export type CompareSlotNumber = 1 | 2 | 3;

export interface CompareListSlot {
  slot: CompareSlotNumber;
  item: CompareListItem | null;
}

export interface CompareListItem {
  slot: CompareSlotNumber;
  sessionId: string;
  url: string;
  status: string;
  createdAt?: string;
  completedAt?: string;
  freshness: { isStale: boolean; ageDays: number };
  schoolName: string;
  classification: { isEducational: boolean; confidence: number | null } | null;
  overallScore: number | null;
}

export interface CompareListResponse {
  compareListId: string;
  slots: CompareListSlot[];
}

export interface CompareAddResponse {
  slot: CompareSlotNumber;
  sessionId: string;
  status: string;
}

export interface CompareApiError {
  code: 'DUPLICATE' | 'SLOT_FULL' | 'IN_PROGRESS' | 'STALE' | 'NOT_FOUND' | string;
  message: string;
  slot?: number;
  sessionId?: string;
  ageDays?: number;
  completedAt?: string;
}
