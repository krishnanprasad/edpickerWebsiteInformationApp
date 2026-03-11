import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalyticsOverviewResponse } from '../models/analytics.models';
import { AnalyticsService } from '../services/analytics.service';

@Component({
  selector: 'app-analytics-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="analytics-shell">
      <header class="analytics-header">
        <div>
          <h1>EdPicker Analytics</h1>
          <p>Business dashboard for crawl, compare, and question KPIs.</p>
        </div>
        <a class="home-link" href="/">Back to Home</a>
      </header>

      <section class="gate" *ngIf="!data">
        <label for="analytics-password">Password</label>
        <div class="gate-row">
          <input
            id="analytics-password"
            type="password"
            [(ngModel)]="password"
            placeholder="Enter analytics password"
            (keyup.enter)="unlock()"
          />
          <button (click)="unlock()" [disabled]="loading">{{ loading ? 'Loading...' : 'Unlock' }}</button>
        </div>
        <p class="error" *ngIf="error">{{ error }}</p>
      </section>

      <section class="content" *ngIf="data">
        <div class="meta-row">
          <div class="meta-chip">Generated: {{ formatDateTime(data.generatedAt) }}</div>
          <div class="meta-chip warn">Users: {{ data.users.note }}</div>
        </div>

        <section class="card">
          <h2>Core KPIs</h2>
          <div class="kpi-grid">
            <div class="kpi"><div class="k">Total scan runs</div><div class="v">{{ data.totals.totalScanRuns }}</div></div>
            <div class="kpi"><div class="k">Unique schools crawled</div><div class="v">{{ data.totals.uniqueSchoolsCrawled }}</div></div>
            <div class="kpi"><div class="k">Completed scans</div><div class="v">{{ data.totals.completedScans }}</div></div>
            <div class="kpi"><div class="k">Successful scans</div><div class="v">{{ data.totals.successfulScans }}</div></div>
            <div class="kpi"><div class="k">Rejected scans</div><div class="v">{{ data.totals.rejectedScans }}</div></div>
            <div class="kpi"><div class="k">Failed scans</div><div class="v">{{ data.totals.failedScans }}</div></div>
            <div class="kpi"><div class="k">Comparisons done (>=2 schools)</div><div class="v">{{ data.comparisons.comparisonsDone }}</div></div>
            <div class="kpi"><div class="k">Questions asked</div><div class="v">{{ data.questions.totalQuestionsAsked }}</div></div>
            <div class="kpi"><div class="k">Questions / scan</div><div class="v">{{ data.questions.questionsPerScan }}</div></div>
            <div class="kpi"><div class="k">% completed scans with question</div><div class="v">{{ data.questions.completedScanQuestionRatePercent }}%</div></div>
            <div class="kpi"><div class="k">B2B CTA clicks</div><div class="v">{{ data.b2b.totalCtaClicks }}</div></div>
            <div class="kpi"><div class="k">B2B conversion</div><div class="v">{{ data.b2b.conversionPercent }}%</div></div>
          </div>
        </section>

        <section class="card">
          <h2>Crawl Time</h2>
          <div class="kpi-grid compact">
            <div class="kpi"><div class="k">Average</div><div class="v">{{ formatMs(data.crawlTime.averageMs) }}</div></div>
            <div class="kpi"><div class="k">Median</div><div class="v">{{ formatMs(data.crawlTime.medianMs) }}</div></div>
            <div class="kpi"><div class="k">P95</div><div class="v">{{ formatMs(data.crawlTime.p95Ms) }}</div></div>
          </div>
          <h3>Slowest schools</h3>
          <table class="table">
            <thead>
              <tr><th>School</th><th>Duration</th><th>Completed</th><th>URL</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.crawlTime.slowestSchools">
                <td>{{ row.schoolName }}</td>
                <td>{{ formatMs(row.durationMs) }}</td>
                <td>{{ row.completedAt ? formatDateTime(row.completedAt) : '-' }}</td>
                <td class="truncate">{{ row.url }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>Comparisons</h2>
          <div class="kpi-grid compact">
            <div class="kpi"><div class="k">Compare lists created</div><div class="v">{{ data.comparisons.compareListsCreated }}</div></div>
            <div class="kpi"><div class="k">Schools added to compare</div><div class="v">{{ data.comparisons.schoolsAddedToCompare }}</div></div>
          </div>
          <h3>Most compared schools</h3>
          <table class="table">
            <thead>
              <tr><th>School</th><th>Website</th><th>Compare adds</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.comparisons.mostComparedSchools">
                <td>{{ row.schoolName }}</td>
                <td class="truncate">{{ row.website }}</td>
                <td>{{ row.compareAdds }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>Questions</h2>
          <h3>Questions by school</h3>
          <table class="table">
            <thead>
              <tr><th>School</th><th>Website</th><th>Total questions</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.questions.bySchool">
                <td>{{ row.schoolName }}</td>
                <td class="truncate">{{ row.website }}</td>
                <td>{{ row.totalQuestions }}</td>
              </tr>
            </tbody>
          </table>

          <h3>Latest questions</h3>
          <table class="table">
            <thead>
              <tr><th>Asked at</th><th>School</th><th>Question</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.questions.latest">
                <td>{{ formatDateTime(row.askedAt) }}</td>
                <td>{{ row.schoolName }}</td>
                <td>{{ row.question }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>School Popularity</h2>
          <h3>Most scanned schools</h3>
          <table class="table">
            <thead>
              <tr><th>School</th><th>Website</th><th>Scans</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.popularity.mostScannedSchools">
                <td>{{ row.schoolName }}</td>
                <td class="truncate">{{ row.website }}</td>
                <td>{{ row.scans }}</td>
              </tr>
            </tbody>
          </table>

          <h3>Most clicked/engaged counters</h3>
          <p class="sub-warn">{{ data.popularity.countersReliabilityNote }}</p>
          <table class="table">
            <thead>
              <tr><th>School</th><th>Views</th><th>Compares</th><th>Searches</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.popularity.topSchoolCounters">
                <td>{{ row.schoolName }}</td>
                <td>{{ row.viewCount }}</td>
                <td>{{ row.compareCount }}</td>
                <td>{{ row.searchCount }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>Schools Crawled</h2>
          <table class="table">
            <thead>
              <tr><th>Name</th><th>Website</th><th>Last crawled</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of data.totals.schoolsCrawledList">
                <td>{{ row.name }}</td>
                <td class="truncate">{{ row.website }}</td>
                <td>{{ row.lastCrawledAt ? formatDateTime(row.lastCrawledAt) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    </main>
  `,
  styles: [`
    .analytics-shell { max-width: 1200px; margin: 0 auto; padding: 24px; color: #13293d; }
    .analytics-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
    .analytics-header h1 { margin: 0; font-size: 30px; }
    .analytics-header p { margin: 8px 0 0; color: #415a77; }
    .home-link { color: #0f766e; text-decoration: none; font-weight: 700; }
    .gate { background: #fff; border: 1px solid #d8e2ec; border-radius: 14px; padding: 16px; max-width: 560px; }
    .gate-row { display: flex; gap: 10px; margin-top: 8px; }
    input { flex: 1; border: 1px solid #b9c9d8; border-radius: 10px; padding: 10px 12px; font-size: 14px; }
    button { border: 0; background: #0f766e; color: #fff; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: 0.7; cursor: not-allowed; }
    .error { color: #b91c1c; margin-top: 10px; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .meta-chip { font-size: 12px; border-radius: 999px; padding: 4px 10px; background: #e0f2fe; color: #0c4a6e; }
    .meta-chip.warn { background: #fff7ed; color: #9a3412; }
    .card { margin-bottom: 12px; border: 1px solid #d8e2ec; border-radius: 14px; padding: 14px; background: #fff; }
    h2 { margin: 0 0 10px; font-size: 20px; }
    h3 { margin: 10px 0 8px; font-size: 15px; color: #334155; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .kpi-grid.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; background: #f8fafc; }
    .kpi .k { font-size: 12px; color: #475569; }
    .kpi .v { margin-top: 4px; font-size: 22px; font-weight: 800; color: #0f172a; }
    .table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .table th, .table td { border-bottom: 1px solid #e2e8f0; text-align: left; padding: 8px 6px; vertical-align: top; }
    .truncate { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-warn { margin: 0 0 8px; color: #9a3412; font-size: 12px; }
    @media (max-width: 960px) {
      .analytics-shell { padding: 14px; }
      .analytics-header { flex-direction: column; }
      .kpi-grid, .kpi-grid.compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .gate-row { flex-direction: column; }
    }
  `],
})
export class AnalyticsPageComponent {
  private readonly analyticsService = inject(AnalyticsService);

  password = '';
  loading = false;
  error = '';
  data: AnalyticsOverviewResponse | null = null;

  unlock() {
    this.error = '';
    if (!this.password.trim()) {
      this.error = 'Please enter password.';
      return;
    }

    this.loading = true;
    this.analyticsService.getOverview(this.password).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
      },
      error: (err: { status?: number }) => {
        this.loading = false;
        if (err?.status === 401) {
          this.error = 'Wrong password.';
          return;
        }
        this.error = 'Could not load analytics. Please try again.';
      },
    });
  }

  formatMs(value: number | null): string {
    if (value === null || Number.isNaN(value)) return '-';
    if (value < 1000) return `${value} ms`;
    const seconds = value / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    return `${(seconds / 60).toFixed(1)} min`;
  }

  formatDateTime(input: string): string {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return input;
    return date.toLocaleString();
  }
}
