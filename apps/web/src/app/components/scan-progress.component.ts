import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScanStatus, CrawlSummary } from '../models/scan.models';

@Component({
  selector: 'app-scan-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="progress-card">
      <div class="step-dots">
        <div class="dot" *ngFor="let s of stepOrder; let i = index"
             [class.active]="i <= currentIdx" [class.current]="i === currentIdx">
        </div>
      </div>
      <p class="progress-label">{{ statusLabel }}</p>
      <p class="progress-sub">{{ statusDescription }}</p>
      <div class="bar-track"><div class="bar-fill" [style.width.%]="percent"></div></div>
      <div class="crawl-stats" *ngIf="crawlSummary && (status === 'Crawling' || status === 'Scoring')">
        <span class="stat-chip">{{ crawlSummary.pagesScanned }} pages read</span>
        <span class="stat-chip" *ngIf="crawlSummary.pdfsScanned">{{ crawlSummary.pdfsScanned }} PDFs</span>
      </div>
      <!-- SSE real-time counters (show even before poll delivers crawlSummary) -->
      <div class="crawl-stats" *ngIf="!crawlSummary && pagesCrawled > 0 && status === 'Crawling'">
        <span class="stat-chip">{{ pagesCrawled }} pages read</span>
        <span class="stat-chip" *ngIf="pagesDiscovered > 0">{{ pagesDiscovered }} discovered</span>
        <span class="stat-chip" *ngIf="factsExtracted > 0">{{ factsExtracted }} facts</span>
      </div>

      <!-- Educational tips carousel while loading -->
      <div class="tips-section">
        <div class="tip-card" [class.tip-fade]="tipFading">
          <span class="tip-icon">💡</span>
          <div class="tip-content">
            <span class="tip-label">Did you know?</span>
            <p class="tip-text">{{ currentTip }}</p>
          </div>
        </div>
        <div class="tip-dots">
          <span class="tip-dot" *ngFor="let tip of tips; let i = index" [class.active]="i === currentTipIndex"></span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .progress-card {
      text-align: center;
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 28px 24px;
      box-shadow: var(--sl-shadow);
    }
    .step-dots { display: flex; justify-content: center; gap: 10px; margin-bottom: 20px; }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #e0e0e0; transition: all 0.3s;
    }
    .dot.active { background: var(--sl-primary, #1a237e); }
    .dot.current { transform: scale(1.4); box-shadow: 0 0 0 4px rgba(26,35,126,0.2); animation: dotPulse 1.5s ease-in-out infinite; }
    @keyframes dotPulse {
      0%, 100% { box-shadow: 0 0 0 4px rgba(26,35,126,0.2); }
      50% { box-shadow: 0 0 0 8px rgba(26,35,126,0.1); }
    }
    .progress-label {
      font-size: 18px; font-weight: 600;
      color: var(--sl-text, #212121);
      margin: 0 0 4px;
    }
    .progress-sub {
      font-size: 13px; color: var(--sl-text-muted, #616161);
      margin: 0 0 20px;
    }
    .bar-track {
      height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;
      max-width: 400px; margin: 0 auto;
    }
    .bar-fill {
      height: 100%; background: var(--sl-primary, #1a237e);
      border-radius: 3px; transition: width 0.6s ease;
    }
    .crawl-stats {
      display: flex; justify-content: center; gap: 10px;
      margin-top: 14px;
    }
    .stat-chip {
      display: inline-block;
      background: #e8eaf6; color: var(--sl-primary, #1a237e);
      padding: 4px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 500;
    }

    /* Educational tips carousel */
    .tips-section {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    }
    .tip-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: linear-gradient(135deg, #fff8e1 0%, #fff3e0 100%);
      border-radius: 12px;
      padding: 16px 20px;
      max-width: 500px;
      margin: 0 auto;
      text-align: left;
      transition: opacity 0.3s ease;
    }
    .tip-card.tip-fade {
      opacity: 0;
    }
    .tip-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    .tip-content {
      flex: 1;
    }
    .tip-label {
      font-size: 11px;
      font-weight: 600;
      color: #e65100;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .tip-text {
      margin: 4px 0 0;
      font-size: 14px;
      color: var(--sl-text, #212121);
      line-height: 1.5;
    }
    .tip-dots {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-top: 12px;
    }
    .tip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #d0d0d0;
      transition: all 0.3s;
    }
    .tip-dot.active {
      background: #e65100;
      transform: scale(1.3);
    }
  `],
})
export class ScanProgressComponent implements OnInit, OnDestroy {
  @Input() status: ScanStatus = 'Classifying';
  @Input() crawlSummary: CrawlSummary | null = null;
  @Input() pagesCrawled = 0;
  @Input() pagesDiscovered = 0;
  @Input() factsExtracted = 0;

  stepOrder: ScanStatus[] = ['Classifying', 'Crawling', 'Scoring', 'Ready'];

  // Educational tips carousel
  tips: string[] = [
    'Ask about safety certifications like Fire NOC and CCTV to ensure campus security.',
    'A transparent fee structure helps you plan your budget without surprises.',
    'Check if the school has a clear admission process with published dates.',
    'Schools with published academic calendars help parents plan vacations better.',
    'Look for transport safety features like GPS tracking and trained drivers.',
    'Anti-bullying policies show the school cares about emotional well-being.',
    'Check student-teacher ratio - smaller ratios often mean more attention per child.',
    'Schools that publish results and achievements are confident in their outcomes.',
  ];
  currentTipIndex = 0;
  tipFading = false;
  private tipTimer: ReturnType<typeof setInterval> | null = null;

  get currentTip(): string {
    return this.tips[this.currentTipIndex];
  }

  ngOnInit(): void {
    this.tipTimer = setInterval(() => {
      this.tipFading = true;
      setTimeout(() => {
        this.currentTipIndex = (this.currentTipIndex + 1) % this.tips.length;
        this.tipFading = false;
      }, 300);
    }, 3000);
  }

  ngOnDestroy(): void {
    if (this.tipTimer) {
      clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
  }

  get currentIdx(): number {
    if (this.status === 'Rejected' || this.status === 'Uncertain') {
      return this.stepOrder.length - 1;
    }
    const i = this.stepOrder.indexOf(this.status);
    return i >= 0 ? i : 0;
  }

  get percent(): number {
    return ((this.currentIdx + 1) / this.stepOrder.length) * 100;
  }

  get statusLabel(): string {
    switch (this.status) {
      case 'Classifying': return 'Checking school website…';
      case 'Crawling': return 'Reading school information…';
      case 'Scoring': return 'Preparing your summary…';
      case 'Ready': return 'Your summary is ready!';
      case 'Uncertain': return 'We need a quick review';
      case 'Rejected': return 'We couldn\'t verify this school';
      default: return 'Working on it…';
    }
  }

  get statusDescription(): string {
    switch (this.status) {
      case 'Classifying': return 'Making sure this is a school website';
      case 'Crawling': {
        if (this.pagesCrawled > 0) return `Read ${this.pagesCrawled} pages, found ${this.factsExtracted} facts so far…`;
        return this.crawlSummary ? `Found ${this.crawlSummary.pagesScanned} pages so far…` : 'Going through the school\'s pages to gather details';
      }
      case 'Scoring': return 'Organising what we found into a clear summary for you';
      case 'Ready': return 'Scroll down to see everything we found';
      case 'Uncertain': return 'This may be a school, but we need stronger educational signals to continue automatically';
      case 'Rejected': return 'This doesn\'t appear to be a school website';
      default: return '';
    }
  }
}

