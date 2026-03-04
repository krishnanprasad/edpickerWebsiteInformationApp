import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

type HighlightItem = { point: string; source_url: string; confidence: 'high' | 'medium' };
type RedFlagItem = { flag: string; severity: 'high' | 'medium'; reason: string };

type PanelState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'running' | 'incomplete';
  message?: string;
  refreshedHours?: number;
  highlights?: HighlightItem[];
  redflags?: RedFlagItem[];
};

type AnalysisCard = {
  id: string;
  url: string;
  status: string;
  score?: number;
  summary?: string;
  panel: 'none' | 'highlights' | 'redflags';
  highlightsState: PanelState;
  redflagsState: PanelState;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatChipsModule,
  ],
  template: `
    <main style="max-width: 1080px; margin: 24px auto; padding: 0 12px; display: grid; gap: 16px;">
      <h1>SchoolLens (Angular 17)</h1>

      <mat-card>
        <h3>Analyze School</h3>
        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>School URL</mat-label>
          <input matInput [(ngModel)]="url" placeholder="https://example.edu" />
        </mat-form-field>
        <button mat-raised-button color="primary" (click)="scan()">Scan</button>
        <p>{{status}}</p>
      </mat-card>

      <mat-card *ngIf="cards.length">
        <h3>Comparison Table</h3>
        <div style="display: grid; gap: 8px;">
          <div *ngFor="let card of cards" style="display:flex; align-items:center; justify-content:space-between; border:1px solid #eee; padding:8px; border-radius:8px;">
            <div>
              <strong>{{card.url}}</strong>
              <span style="margin-left:8px; color:#666;">{{card.status}}</span>
            </div>
            <div *ngIf="bothPanelsGenerated(card)" style="display:flex; gap:8px;">
              <mat-chip color="warn" (click)="togglePanel(card, 'redflags')" style="cursor:pointer;">🚩 {{(card.redflagsState.redflags || []).length}} flags</mat-chip>
              <mat-chip color="primary" (click)="togglePanel(card, 'highlights')" style="cursor:pointer;">✅ {{(card.highlightsState.highlights || []).length}} confirmed</mat-chip>
            </div>
          </div>
        </div>
      </mat-card>

      <mat-card *ngFor="let card of cards" style="border: 1px solid #ddd;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
          <div>
            <h3 style="margin:0 0 8px 0;">{{card.url}}</h3>
            <div style="color:#666;">Status: {{card.status}}</div>
            <div *ngIf="card.score !== undefined" style="margin-top:4px;">Score: {{card.score}}/100</div>
            <div *ngIf="card.summary" style="margin-top:4px; color:#555;">{{card.summary}}</div>
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:14px;">
          <button
            mat-stroked-button
            style="border-color:#16a34a; color:#166534;"
            [disabled]="isButtonsDisabled(card)"
            [matTooltip]="tooltipFor(card)"
            (click)="togglePanel(card, 'highlights')">
            ✅ 5 Things to Know
          </button>

          <button
            mat-stroked-button
            style="border-color:#dc2626; color:#991b1b;"
            [disabled]="isButtonsDisabled(card)"
            [matTooltip]="tooltipFor(card)"
            (click)="togglePanel(card, 'redflags')">
            🚩 Red Flags
          </button>
        </div>

        <div *ngIf="card.panel === 'highlights'" style="margin-top:12px; padding:12px; border-radius:10px; background:#ecfdf5; border:1px solid #bbf7d0;">
          <div *ngIf="card.highlightsState.status === 'loading'">Loading highlights...</div>
          <div *ngIf="card.highlightsState.status === 'running'">Available once analysis is ready.</div>
          <div *ngIf="card.highlightsState.status === 'incomplete'">Analysis incomplete, limited data available.</div>
          <div *ngIf="card.highlightsState.status === 'error'">Could not generate highlights right now. You can view raw findings in the full report.</div>

          <div *ngIf="card.highlightsState.status === 'ready'">
            <div *ngFor="let item of card.highlightsState.highlights; let i = index" style="display:grid; grid-template-columns:30px 1fr; gap:8px; margin-bottom:10px;">
              <div style="width:28px;height:28px;border-radius:50%;background:#166534;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;">{{i+1}}</div>
              <div>
                <div>{{item.point}} <span *ngIf="item.confidence === 'medium'" style="color:#666; font-size:12px;">(approximate)</span></div>
                <mat-chip style="margin-top:4px; color:#6b7280;">Found on: {{readableSource(item.source_url)}}</mat-chip>
              </div>
            </div>

            <div style="font-size:12px; color:#6b7280; margin-top:8px;">Based on content found on the school website during analysis.</div>
            <div style="font-size:12px; color:#6b7280;" *ngIf="(card.highlightsState.highlights || []).length < 5">
              Only {{(card.highlightsState.highlights || []).length}} points could be confirmed from available data.
            </div>
            <div style="font-size:12px; color:#6b7280; margin-top:6px;">Refreshed {{card.highlightsState.refreshedHours || 0}} hours ago</div>
          </div>
        </div>

        <div *ngIf="card.panel === 'redflags'" style="margin-top:12px; padding:12px; border-radius:10px; background:#fff7ed; border:1px solid #fdba74;">
          <div *ngIf="card.redflagsState.status === 'loading'">Checking for gaps...</div>
          <div *ngIf="card.redflagsState.status === 'running'">Available once analysis is ready.</div>
          <div *ngIf="card.redflagsState.status === 'incomplete'">Analysis incomplete, limited data available.</div>
          <div *ngIf="card.redflagsState.status === 'error'">Could not generate highlights right now. You can view raw findings in the full report.</div>

          <div *ngIf="card.redflagsState.status === 'ready'">
            <div *ngIf="!(card.redflagsState.redflags || []).length" style="color:#166534; font-weight:600;">No major gaps found in publicly available information</div>
            <div *ngFor="let flag of card.redflagsState.redflags" style="display:grid; grid-template-columns:24px 1fr; gap:8px; margin-bottom:10px;">
              <div>🚩</div>
              <div>
                <div>
                  {{flag.flag}}
                  <span [style.background]="flag.severity === 'high' ? '#dc2626' : '#f59e0b'" style="color:white; border-radius:12px; padding:2px 8px; font-size:11px; margin-left:8px;">{{flag.severity}}</span>
                </div>
                <div style="font-style: italic; color:#6b7280;">{{flag.reason}}</div>
              </div>
            </div>

            <div style="font-size:12px; color:#6b7280; margin-top:8px;">These gaps were identified from publicly available website content. We recommend asking the school directly during your visit.</div>
            <div style="font-size:12px; color:#6b7280; margin-top:6px;">Refreshed {{card.redflagsState.refreshedHours || 0}} hours ago</div>
          </div>
        </div>
      </mat-card>
    </main>
  `,
})
export class AppComponent {
  private readonly http = inject(HttpClient);

  url = '';
  status = '';
  cards: AnalysisCard[] = [];

  async scan() {
    if (!this.url.trim()) return;
    this.status = 'Submitting...';

    const response = await this.http.post<{ sessionId?: string; session?: { id: string }; status?: string }>('/api/scan', { url: this.url }).toPromise();
    const sessionId = response?.sessionId || response?.session?.id;
    if (!sessionId) {
      this.status = 'Unable to start scan';
      return;
    }

    const existing = this.cards.find((x) => x.id === sessionId);
    if (!existing) {
      this.cards.unshift({
        id: sessionId,
        url: this.url.trim(),
        status: response?.status || 'Queued',
        panel: 'none',
        highlightsState: { status: 'idle' },
        redflagsState: { status: 'idle' },
      });
    }

    this.status = `Queued: ${sessionId}`;
    this.startPolling(sessionId);
  }

  startPolling(sessionId: string) {
    const interval = setInterval(async () => {
      const card = this.cards.find((x) => x.id === sessionId);
      if (!card) {
        clearInterval(interval);
        return;
      }

      const data = await this.http.get<any>(`/api/scan/${sessionId}`).toPromise();
      if (!data) return;
      card.status = data.status;
      card.score = data.overall_score ?? data.overallScore;
      card.summary = data.summary;
      card.url = data.url || card.url;

      if (data.status === 'Ready' || data.status === 'Failed') {
        clearInterval(interval);
      }
    }, 2500);
  }

  isButtonsDisabled(card: AnalysisCard): boolean {
    return card.status !== 'Ready' && card.status !== 'Failed';
  }

  tooltipFor(card: AnalysisCard): string {
    return this.isButtonsDisabled(card) ? 'Available once analysis is ready.' : '';
  }

  async togglePanel(card: AnalysisCard, panel: 'highlights' | 'redflags') {
    if (card.panel === panel) {
      card.panel = 'none';
      return;
    }

    card.panel = panel;

    if (card.status === 'Failed') {
      if (panel === 'highlights') card.highlightsState = { status: 'incomplete', message: 'Analysis incomplete, limited data available.' };
      if (panel === 'redflags') card.redflagsState = { status: 'incomplete', message: 'Analysis incomplete, limited data available.' };
      return;
    }

    if (panel === 'highlights' && card.highlightsState.status === 'idle') {
      await this.loadHighlights(card);
    }

    if (panel === 'redflags' && card.redflagsState.status === 'idle') {
      await this.loadRedflags(card);
    }

    // Independent loading case when one exists and one doesn't
    if (panel === 'redflags' && card.redflagsState.status === 'error') {
      await this.loadRedflags(card);
    }
  }

  async loadHighlights(card: AnalysisCard) {
    card.highlightsState = { status: 'loading' };
    const response = await this.http.get<any>(`/api/scan/${card.id}/highlights`).toPromise();

    if (!response) {
      card.highlightsState = { status: 'error', message: 'Could not generate highlights right now. You can view raw findings in the full report.' };
      return;
    }

    card.highlightsState = {
      status: response.status,
      message: response.message,
      highlights: response.items || [],
      refreshedHours: response.refreshedHours || 0,
    };
  }

  async loadRedflags(card: AnalysisCard) {
    card.redflagsState = { status: 'loading' };
    const response = await this.http.get<any>(`/api/scan/${card.id}/redflags`).toPromise();

    if (!response) {
      card.redflagsState = { status: 'error', message: 'Could not generate highlights right now. You can view raw findings in the full report.' };
      return;
    }

    card.redflagsState = {
      status: response.status,
      message: response.message,
      redflags: response.items || [],
      refreshedHours: response.refreshedHours || 0,
    };
  }

  readableSource(sourceUrl: string): string {
    try {
      const path = new URL(sourceUrl).pathname.replace(/\//g, ' ').trim();
      if (!path) return 'Homepage';
      return path
        .split(' ')
        .filter(Boolean)
        .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
        .join(' ');
    } catch {
      return sourceUrl;
    }
  }

  bothPanelsGenerated(card: AnalysisCard): boolean {
    return card.highlightsState.status === 'ready' && card.redflagsState.status === 'ready';
  }
}
