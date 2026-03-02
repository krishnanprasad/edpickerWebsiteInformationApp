import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CompareAddResponse, CompareListResponse } from '../models/compare.models';

const STORAGE_KEY = 'schoollens:compareListId';

@Injectable({ providedIn: 'root' })
export class CompareService {
  private readonly http = inject(HttpClient);

  getStoredCompareListId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  setStoredCompareListId(id: string) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  clearStoredCompareListId() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  createCompareList(): Observable<{ compareListId: string }> {
    return this.http.post<{ compareListId: string }>('/api/compare-lists', {});
  }

  getCompareList(compareListId: string): Observable<CompareListResponse> {
    return this.http.get<CompareListResponse>(`/api/compare-lists/${compareListId}`);
  }

  addSchool(compareListId: string, url: string, staleAction?: 'add_anyway' | 'refresh'): Observable<CompareAddResponse> {
    return this.http.post<CompareAddResponse>(`/api/compare-lists/${compareListId}/items`, { url, staleAction });
  }

  removeSlot(compareListId: string, slot: 1 | 2 | 3): Observable<{ ok: boolean; deleted: number }> {
    return this.http.delete<{ ok: boolean; deleted: number }>(`/api/compare-lists/${compareListId}/items/${slot}`);
  }

  clearAll(compareListId: string): Observable<{ ok: boolean; deleted: number }> {
    return this.http.delete<{ ok: boolean; deleted: number }>(`/api/compare-lists/${compareListId}/items`);
  }

  refreshSession(sessionId: string): Observable<{ ok: true; sessionId: string; status: string } | any> {
    return this.http.post(`/api/scan/${sessionId}/refresh`, {});
  }
}
