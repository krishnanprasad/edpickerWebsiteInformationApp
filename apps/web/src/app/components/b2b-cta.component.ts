import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ScanService } from '../services/scan.service';

@Component({
  selector: 'app-b2b-cta',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="cta-card" *ngIf="sessionId">
      <span class="cta-emoji">🏫</span>
      <div class="cta-body">
        <p class="cta-title">Are you from this school?</p>
        <p class="cta-sub">Claim your profile and show parents the full picture — it's free to get started.</p>
      </div>
      <button class="cta-btn" (click)="onCtaClick()" [disabled]="!!successMessage">
        <mat-icon>verified</mat-icon> Claim Profile
      </button>
      <p *ngIf="successMessage" class="success-msg">{{ successMessage }}</p>
    </div>
  `,
  styles: [`
    .cta-card {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 20px 24px;
      box-shadow: var(--sl-shadow);
      border: 1.5px dashed #c5cae9;
    }
    .cta-emoji { font-size: 32px; }
    .cta-body { flex: 1; min-width: 180px; }
    .cta-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--sl-text, #212121); }
    .cta-sub { margin: 2px 0 0; font-size: 13px; color: var(--sl-text-muted, #616161); }
    .cta-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--sl-primary, #1a237e); color: #fff;
      border: none; border-radius: 10px; padding: 10px 20px;
      font-size: 14px; font-weight: 500; cursor: pointer;
      transition: background 0.2s;
      font-family: 'Roboto', sans-serif;
    }
    .cta-btn:hover:not(:disabled) { background: var(--sl-accent, #0d47a1); }
    .cta-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .cta-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .success-msg {
      width: 100%; margin: 8px 0 0;
      font-size: 13px; color: var(--sl-green, #2e7d32);
    }
  `],
})
export class B2bCtaComponent {
  @Input() sessionId: string | null = null;
  private readonly scanService = inject(ScanService);
  successMessage = '';

  onCtaClick() {
    if (!this.sessionId) return;
    this.scanService.trackB2bInterest(this.sessionId).subscribe({
      next: (res) => {
        this.successMessage = 'Thanks! We\'ll be in touch soon.';
        if (res.ctaUrl) window.open(res.ctaUrl, '_blank');
      },
      error: () => { this.successMessage = 'Something went wrong. Please try again.'; },
    });
  }
}
