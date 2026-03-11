import { Injectable, inject, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, switchMap, takeWhile, map, startWith } from 'rxjs';
import { ScanResponse, AskResponse, B2bInterestResponse, ScanStatus, SSEEvent, SSEEventType, RedFlagsResponse, CrawledSchoolOption, SchoolInfoCoreResponse } from '../models/scan.models';
import { CrashHandlerService } from './crash-handler.service';

@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);
  private readonly crashHandler = inject(CrashHandlerService);

  /** Submit a URL for scanning (returns sessionId + initial status). */
  submitScan(url: string): Observable<ScanResponse> {
    return this.http.post<ScanResponse>('/api/scan', { url });
  }

  /** Fetch current scan status (full enriched response). */
  getStatus(sessionId: string): Observable<ScanResponse> {
    return this.http.get<ScanResponse>(`/api/scan/${sessionId}`);
  }

  /**
   * Connect to SSE stream for real-time crawl events.
   * Falls back to polling if SSE is not available.
   */
  connectSSE(sessionId: string): Observable<SSEEvent> {
    return new Observable<SSEEvent>((subscriber) => {
      const url = `/api/scan/${sessionId}/events`;
      const eventSource = new EventSource(url);

      const eventTypes: SSEEventType[] = [
        'discovery_start', 'discovery_complete',
        'page_crawled', 'early_stop',
        'identity',
        'preliminary_score',
        'crawl_complete',
        'scoring_start', 'final_score',
        'complete', 'error',
      ];

      for (const type of eventTypes) {
        eventSource.addEventListener(type, (event: MessageEvent) => {
          this.zone.run(() => {
            try {
              const data = JSON.parse(event.data);
              subscriber.next({ type, data });
              if (type === 'complete' || type === 'error') {
                subscriber.complete();
              }
            } catch { /* ignore malformed */ }
          });
        });
      }

      eventSource.onerror = () => {
        this.zone.run(() => {
          this.crashHandler.report('Live updates disconnected. Please return to Home while we repair it.');
          eventSource.close();
          subscriber.complete();
        });
      };

      return () => {
        eventSource.close();
      };
    });
  }

  /**
   * Poll scan status every `intervalMs` until status is terminal.
   * Emits each intermediate response so the UI can show progress.
   * Stops after maxPolls attempts (~5 minutes at 2s intervals).
   */
  pollUntilDone(sessionId: string, intervalMs = 2000, maxPolls = 150): Observable<ScanResponse> {
    let pollCount = 0;
    return interval(intervalMs).pipe(
      startWith(0),
      switchMap(() => this.getStatus(sessionId)),
      takeWhile((res) => {
        pollCount++;
        return !this.isTerminal(res.status) && pollCount < maxPolls;
      }, true),
    );
  }

  /** Ask a question about crawled content. */
  ask(sessionId: string, question: string): Observable<AskResponse> {
    return this.http.post<AskResponse>(`/api/scan/${sessionId}/ask`, { question });
  }

  /** Fetch AI-generated red flags for a completed scan (lazily, cached server-side). */
  getRedFlags(sessionId: string): Observable<RedFlagsResponse> {
    return this.http.get<RedFlagsResponse>(`/api/scan/${sessionId}/red-flags`);
  }

  /** Fetch 10-category School Information Core score (0-3 per category). */
  getSchoolInfoCore(sessionId: string): Observable<SchoolInfoCoreResponse> {
    return this.http.get<SchoolInfoCoreResponse>(`/api/scan/${sessionId}/school-info-core`);
  }

  /** Track B2B CTA interest click. */
  trackB2bInterest(sessionId: string): Observable<B2bInterestResponse> {
    return this.http.post<B2bInterestResponse>('/api/b2b-interest', { sessionId });
  }

  /** Search already crawled schools from registry for picker autocomplete. */
  searchCrawledSchools(query: string): Observable<{ items: CrawledSchoolOption[] }> {
    return this.http.get<{ items: CrawledSchoolOption[] }>(`/api/schools/search?q=${encodeURIComponent(query)}`);
  }

  private isTerminal(status: ScanStatus): boolean {
    return status === 'Ready' || status === 'Rejected' || status === 'Uncertain' || status === 'Failed' || status === 'Error';
  }
}
