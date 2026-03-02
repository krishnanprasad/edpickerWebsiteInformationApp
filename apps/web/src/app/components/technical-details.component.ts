import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CrawlSummary } from '../models/scan.models';

@Component({
  selector: 'app-technical-details',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="tech-wrap">
      <button class="toggle-btn" (click)="expanded = !expanded">
        <mat-icon>{{ expanded ? 'expand_less' : 'expand_more' }}</mat-icon>
        {{ expanded ? 'Hide' : 'View' }} Detailed Information
      </button>

      <div class="tech-body" *ngIf="expanded && summary">
        <div class="stat-grid">
          <div class="stat">
            <span class="stat-val">{{ summary.pagesScanned }}</span>
            <span class="stat-label">Pages Read</span>
          </div>
          <div class="stat">
            <span class="stat-val">{{ summary.pdfsScanned }}</span>
            <span class="stat-label">PDFs Found</span>
          </div>
          <div class="stat">
            <span class="stat-val">{{ summary.imagesScanned }}</span>
            <span class="stat-label">Images Found</span>
          </div>
          <div class="stat">
            <span class="stat-val">{{ summary.scanTimeSeconds || '—' }}s</span>
            <span class="stat-label">Time Taken</span>
          </div>
        </div>
        <p class="coverage" *ngIf="summary.scanConfidenceLabel">
          Coverage: {{ summary.scanConfidenceLabel }}
        </p>
      </div>
    </div>
  `,
  styles: [`
    .tech-wrap {
      text-align: center;
    }
    .toggle-btn {
      display: inline-flex; align-items: center; gap: 4px;
      background: none; border: none;
      font-size: 13px; color: var(--sl-text-muted, #616161);
      cursor: pointer; padding: 8px 0;
      font-family: 'Roboto', sans-serif;
      transition: color 0.2s;
    }
    .toggle-btn:hover { color: var(--sl-text, #212121); }
    .toggle-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .tech-body {
      margin-top: 12px;
      background: #fff; border-radius: var(--sl-radius, 12px);
      padding: 20px; box-shadow: var(--sl-shadow);
      text-align: left;
    }
    .stat-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 12px; margin-bottom: 12px;
    }
    @media (max-width: 500px) {
      .stat-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .stat {
      text-align: center; padding: 12px;
      background: #fafafa; border-radius: 10px;
    }
    .stat-val {
      display: block; font-size: 20px; font-weight: 700;
      color: var(--sl-primary, #1a237e);
    }
    .stat-label {
      display: block; font-size: 11px; color: var(--sl-text-muted, #616161);
      margin-top: 4px; text-transform: uppercase; letter-spacing: 0.3px;
    }
    .coverage {
      margin: 0; font-size: 13px;
      color: var(--sl-text-muted, #616161);
    }
  `],
})
export class TechnicalDetailsComponent {
  @Input() summary: CrawlSummary | null = null;
  expanded = false;
}
