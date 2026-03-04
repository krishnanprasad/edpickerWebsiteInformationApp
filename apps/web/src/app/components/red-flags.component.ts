import { Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export interface RedFlag {
  severity: 'high' | 'medium';
  flag: string;
  reason: string;
}

export interface RedFlagsResponse {
  sessionId: string;
  flags: RedFlag[];
  generatedAt: string;
  fromCache: boolean;
}

type PanelState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-red-flags',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- ── Trigger button ── -->
    <div class="btn-shell" [class.spinning]="state === 'loading'" [class.loaded]="state === 'loaded'" [class.err]="state === 'error'">
      <button
        class="redflag-btn"
        [disabled]="state === 'loading'"
        (click)="onPress()"
        [attr.aria-expanded]="panelOpen">
        <span class="btn-inner" [class.hide-label]="state === 'loading'">
          <span class="flag-ico" *ngIf="state !== 'loaded'">🚩</span>
          <span class="flag-count" *ngIf="state === 'loaded'">{{ flags.length }}</span>
          {{ buttonLabel }}
        </span>
        <!-- inline spinner dots -->
        <span class="spinner-dots" *ngIf="state === 'loading'" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
    </div>

    <!-- ── Panel (skeleton while loading, flags when loaded) ── -->
    <div class="panel" [class.open]="panelOpen" role="region" aria-label="Red flags panel">
      <div class="panel-inner">

        <!-- LinkedIn skeleton rows while loading -->
        <ng-container *ngIf="state === 'loading'">
          <div class="skel-row" *ngFor="let _ of [0,1,2]">
            <div class="skel-badge"></div>
            <div class="skel-lines">
              <div class="skel-line long"></div>
              <div class="skel-line short"></div>
            </div>
          </div>
        </ng-container>

        <!-- Error state -->
        <div class="error-state" *ngIf="state === 'error'">
          <span>⚠️</span>
          <p>Could not load red flags. Check your connection and try again.</p>
          <button class="retry-btn" (click)="onPress()">Retry</button>
        </div>

        <!-- Actual flags with staggered fade-in -->
        <ng-container *ngIf="state === 'loaded'">
          <div
            class="flag-row"
            *ngFor="let f of flags; let i = index"
            [style.animation-delay]="(i * 80) + 'ms'"
            [class.severity-high]="f.severity === 'high'"
            [class.severity-medium]="f.severity === 'medium'"
          >
            <span class="severity-badge" [class.high]="f.severity === 'high'" [class.medium]="f.severity === 'medium'">
              {{ f.severity === 'high' ? 'High' : 'Medium' }}
            </span>
            <div class="flag-text-wrap">
              <div class="flag-title">{{ f.flag }}</div>
              <div class="flag-reason">{{ f.reason }}</div>
            </div>
          </div>

          <div class="no-flags" *ngIf="flags.length === 0">
            <span>✅</span> No major red flags found based on publicly available information.
          </div>

          <div class="panel-footer">
            <span class="footer-note">Based on crawled website data · {{ timeAgo }}</span>
          </div>
        </ng-container>

      </div>
    </div>
  `,
  styles: [`
    /* ── Button shell (only active when spinning) ── */
    :host { display: block; }

    .btn-shell {
      display: inline-flex;
      border-radius: 10px;
      padding: 0;
      background: transparent;
      position: relative;
      overflow: hidden;
      transition: padding 0.15s;
    }

    /* ── Spinning conic-gradient border — only during loading ── */
    .btn-shell.spinning {
      padding: 2px;
    }
    .btn-shell.spinning::before {
      content: '';
      position: absolute;
      inset: -80%;
      background: conic-gradient(
        from 0deg,
        #dc2626 0deg,
        #f97316 60deg,
        #fbbf24 120deg,
        transparent 180deg,
        transparent 360deg
      );
      animation: spin-ring 1s linear infinite;
      z-index: 0;
    }
    /* re-cover inside so only 2px ring shows */
    .btn-shell.spinning::after {
      content: '';
      position: absolute;
      inset: 2px;
      border-radius: 8px;
      background: #fff;
      z-index: 1;
      pointer-events: none;
    }

    @keyframes spin-ring {
      to { transform: rotate(360deg); }
    }

    /* ── The actual button ── */
    .redflag-btn {
      position: relative;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 110px;
      padding: 8px 14px;
      border: 1.5px solid #dc2626;
      border-radius: 8px;
      background: #fff;
      color: #dc2626;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
      letter-spacing: 0.2px;
      transition: background 0.18s, color 0.18s;
    }
    .redflag-btn:disabled { cursor: not-allowed; opacity: 0.7; }
    .redflag-btn:hover:not(:disabled) { background: #fff5f5; }

    .btn-shell.loaded .redflag-btn { background: #fff5f5; }
    .btn-shell.err    .redflag-btn { border-color: #9ca3af; color: #6b7280; }

    .btn-inner { display: flex; align-items: center; gap: 6px; }
    .btn-inner.hide-label { opacity: 0; width: 0; overflow: hidden; }
    .flag-ico  { font-size: 14px; }
    .flag-count {
      background: #ef4444;
      color: #fff;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 700;
      min-width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
    }

    /* ── Spinner dots ── */
    .spinner-dots {
      display: flex;
      gap: 4px;
      align-items: center;
      position: absolute;
    }
    .spinner-dots span {
      width: 5px; height: 5px;
      border-radius: 50%;
      background: #fff;
      animation: dot-bounce 0.9s ease-in-out infinite;
    }
    .spinner-dots span:nth-child(1) { animation-delay: 0s; }
    .spinner-dots span:nth-child(2) { animation-delay: 0.18s; }
    .spinner-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes dot-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.7; }
      30%            { transform: translateY(-5px); opacity: 1; }
    }

    /* ── Panel ── */
    .panel {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .panel.open {
      max-height: 700px;
    }
    .panel-inner {
      padding: 14px 0 4px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── LinkedIn Skeleton rows ── */
    .skel-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 10px;
      background: #f5f5f5;
    }
    .skel-badge {
      width: 52px; height: 22px;
      border-radius: 6px;
      background: linear-gradient(90deg, #e0e0e0 25%, #eeeeee 50%, #e0e0e0 75%);
      background-size: 200% 100%;
      animation: skel-shimmer 1.4s infinite;
      flex-shrink: 0;
    }
    .skel-lines { flex: 1; display: flex; flex-direction: column; gap: 7px; padding-top: 2px; }
    .skel-line {
      height: 12px; border-radius: 4px;
      background: linear-gradient(90deg, #e0e0e0 25%, #eeeeee 50%, #e0e0e0 75%);
      background-size: 200% 100%;
      animation: skel-shimmer 1.4s infinite;
    }
    .skel-line.long  { width: 80%; }
    .skel-line.short { width: 55%; animation-delay: 0.15s; }
    @keyframes skel-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── Flag rows ── */
    .flag-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 10px;
      background: #fff;
      border-left: 3px solid transparent;
      animation: flag-fadein 0.35s ease both;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .flag-row.severity-high   { border-left-color: #dc2626; background: #fff5f5; }
    .flag-row.severity-medium { border-left-color: #f59e0b; background: #fffbeb; }

    @keyframes flag-fadein {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .severity-badge {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      margin-top: 2px;
      white-space: nowrap;
    }
    .severity-badge.high   { background: #fee2e2; color: #991b1b; }
    .severity-badge.medium { background: #fef3c7; color: #92400e; }

    .flag-text-wrap { flex: 1; }
    .flag-title  { font-size: 13px; font-weight: 600; color: #212121; line-height: 1.4; }
    .flag-reason { font-size: 12px; color: #616161; margin-top: 3px; line-height: 1.5; }

    /* ── No flags ── */
    .no-flags {
      font-size: 13px; color: #2e7d32;
      background: #f0fdf4; border: 1px solid #bbf7d0;
      border-radius: 10px; padding: 12px 14px;
      display: flex; align-items: center; gap: 8px;
    }

    /* ── Footer ── */
    .panel-footer { padding: 6px 2px 2px; }
    .footer-note  { font-size: 11px; color: #9e9e9e; }

    /* ── Error state ── */
    .error-state {
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; padding: 18px; text-align: center;
      background: #f5f5f5; border-radius: 10px;
    }
    .error-state span { font-size: 24px; }
    .error-state p    { font-size: 13px; color: #616161; margin: 0; }
    .retry-btn {
      border: 1px solid #e0e0e0; background: #fff;
      border-radius: 8px; padding: 7px 14px;
      font-size: 13px; cursor: pointer;
      font-family: 'Roboto', sans-serif;
    }
  `],
})
export class RedFlagsComponent implements OnChanges {
  @Input() sessionId = '';
  @Input() completedAt: string | null = null;

  private readonly http = inject(HttpClient);

  state: PanelState = 'idle';
  flags: RedFlag[] = [];
  generatedAt: string | null = null;

  // Cache key → tracks which session + completedAt was last fetched
  private lastFetchedKey = '';

  get panelOpen(): boolean {
    return this.state === 'loading' || this.state === 'loaded' || this.state === 'error';
  }

  get buttonLabel(): string {
    switch (this.state) {
      case 'loading': return 'Gathering gaps...';
      case 'loaded':  return `Red Flag${this.flags.length !== 1 ? 's' : ''}`;
      case 'error':   return 'Could not load — retry';
      default:        return 'Red Flags';
    }
  }

  get timeAgo(): string {
    if (!this.generatedAt) return '';
    const ms = Date.now() - new Date(this.generatedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    // If session changed, reset so button shows fresh
    if (changes['sessionId'] && !changes['sessionId'].firstChange) {
      this.state = 'idle';
      this.flags = [];
      this.generatedAt = null;
      this.lastFetchedKey = '';
    }
  }

  onPress(): void {
    if (this.state === 'loading') return;

    // Toggle: if loaded and panel is open, collapse
    if (this.state === 'loaded') {
      this.state = 'idle';
      return;
    }

    // Check cache: use cached result if session & completedAt unchanged
    const currentKey = `${this.sessionId}::${this.completedAt ?? ''}`;
    if (this.flags.length > 0 && this.lastFetchedKey === currentKey) {
      this.state = 'loaded';
      return;
    }

    this.fetch();
  }

  private fetch(): void {
    if (!this.sessionId) return;
    this.state = 'loading';
    const key = `${this.sessionId}::${this.completedAt ?? ''}`;

    this.http.get<RedFlagsResponse>(`/api/scan/${this.sessionId}/red-flags`).subscribe({
      next: (res) => {
        this.flags = res.flags;
        this.generatedAt = res.generatedAt;
        this.lastFetchedKey = key;
        this.state = 'loaded';
      },
      error: () => {
        this.state = 'error';
      },
    });
  }
}
