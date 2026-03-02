import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { CrawlSummary } from '../models/scan.models';

@Component({
  selector: 'app-crawl-summary',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatChipsModule],
  template: `
    <mat-card class="summary-card" *ngIf="summary">
      <h3 class="section-title">
        <mat-icon>folder_open</mat-icon>
        Crawl Summary
      </h3>

      <div class="stats-grid">
        <div class="stat-item">
          <mat-icon>description</mat-icon>
          <span class="stat-value">{{ summary.pagesScanned }}</span>
          <span class="stat-label">Pages scanned</span>
        </div>
        <div class="stat-item">
          <mat-icon>picture_as_pdf</mat-icon>
          <span class="stat-value">{{ summary.pdfsScanned }}</span>
          <span class="stat-label">PDFs scanned</span>
        </div>
        <div class="stat-item">
          <mat-icon>image</mat-icon>
          <span class="stat-value">{{ summary.imagesScanned }}</span>
          <span class="stat-label">Images scanned</span>
        </div>
        <div class="stat-item">
          <mat-icon>account_tree</mat-icon>
          <span class="stat-value">{{ summary.depthReached }}</span>
          <span class="stat-label">Depth reached</span>
        </div>
        <div class="stat-item">
          <mat-icon>code</mat-icon>
          <span class="stat-value">{{ summary.structuredDataDetected ? 'Yes' : 'No' }}</span>
          <span class="stat-label">Structured data</span>
        </div>
        <div class="stat-item">
          <mat-icon>timer</mat-icon>
          <span class="stat-value">{{ summary.scanTimeSeconds ?? '—' }}s</span>
          <span class="stat-label">Scan time</span>
        </div>
      </div>

      <div class="confidence-row" *ngIf="summary.scanConfidence !== null">
        <mat-icon>psychology</mat-icon>
        <span class="confidence-label">Scan Confidence:</span>
        <span class="confidence-value" [ngClass]="confidenceClass">
          {{ summary.scanConfidence }}%
        </span>
        <span class="confidence-note">(Based on {{ summary.pagesScanned }} internal pages)</span>
      </div>

      <p class="low-confidence-warning" *ngIf="summary.scanConfidence !== null && summary.scanConfidence < 50">
        ⚠️ Low confidence — Limited data available.
      </p>
    </mat-card>
  `,
  styles: [`
    .summary-card { padding: 24px; }
    .section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 18px; color: #1a237e; margin: 0 0 20px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .stat-item {
      display: flex; flex-direction: column; align-items: center;
      padding: 12px 8px;
      background: #f5f5f5; border-radius: 8px;
    }
    .stat-item mat-icon { color: #1976d2; margin-bottom: 4px; }
    .stat-value { font-size: 22px; font-weight: 700; color: #333; }
    .stat-label { font-size: 11px; color: #888; text-align: center; }
    .confidence-row {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; background: #e3f2fd; border-radius: 8px;
      font-size: 14px;
    }
    .confidence-row mat-icon { color: #1565c0; }
    .confidence-label { font-weight: 500; }
    .confidence-value { font-weight: 700; }
    .confidence-value.high { color: #2e7d32; }
    .confidence-value.medium { color: #f57f17; }
    .confidence-value.low { color: #c62828; }
    .confidence-note { color: #888; font-size: 12px; }
    .low-confidence-warning { color: #e65100; font-size: 13px; margin-top: 8px; }
  `],
})
export class CrawlSummaryComponent {
  @Input() summary: CrawlSummary | null = null;

  get confidenceClass(): string {
    if (!this.summary?.scanConfidence) return '';
    if (this.summary.scanConfidence >= 80) return 'high';
    if (this.summary.scanConfidence >= 50) return 'medium';
    return 'low';
  }
}
