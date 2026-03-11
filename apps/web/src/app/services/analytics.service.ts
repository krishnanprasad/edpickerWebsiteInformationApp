import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AnalyticsOverviewResponse } from '../models/analytics.models';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  getOverview(password: string): Observable<AnalyticsOverviewResponse> {
    return this.http.post<AnalyticsOverviewResponse>('/api/analytics/overview', { password });
  }
}
