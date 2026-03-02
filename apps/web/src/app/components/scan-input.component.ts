import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ScanStatus } from '../models/scan.models';

@Component({
  selector: 'app-scan-input',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <!-- ======== COMPACT MINI-HEADER (during processing / results) ======== -->
    <div class="mini-header" *ngIf="compact">
      <div class="mini-inner">
        <div class="mini-left">
          <div class="mini-avatar" *ngIf="schoolName">{{ initials }}</div>
          <div class="mini-avatar mini-avatar-pulse" *ngIf="!schoolName">
            <mat-icon>search</mat-icon>
          </div>
          <div class="mini-meta">
            <span class="mini-name">{{ schoolName || 'Checking website...' }}</span>
            <span class="mini-board" *ngIf="board">{{ board }}</span>
            <span class="mini-status" *ngIf="!board && scanStatus !== 'Ready'">{{ statusLabel }}</span>
          </div>
        </div>
        <button class="mini-reset-btn" (click)="onReset()">
          <mat-icon>close</mat-icon>
          <span class="mini-reset-text">New Search</span>
        </button>
      </div>
    </div>

    <!-- ======== FULL HERO (idle state) ======== -->
    <div class="hero" *ngIf="!compact">
      <div class="hero-content">
        <span class="hero-badge">&#127979; For Parents</span>
        <h1>Choose Schools<br>With Confidence</h1>
        <p class="hero-sub">
          We analyze school websites and highlight what matters most to parents
          — safety, transparency, and academic clarity — so you can ask the
          right questions before admission.
        </p>

        <div class="input-row">
          <div class="input-wrapper">
            <mat-icon class="input-icon">language</mat-icon>
            <input
              class="url-input"
              [(ngModel)]="url"
              placeholder="Enter school website (e.g. www.school.edu.in)"
              (keyup.enter)="onScan()" />
          </div>
          <button class="primary-btn" [disabled]="!url.trim() || scanning" (click)="onScan()">
            {{ scanning ? 'Checking...' : 'Check School' }}
          </button>
        </div>

        <p *ngIf="error" class="error-text">{{ error }}</p>

        <div class="hero-actions">
          <a class="link-btn" (click)="showHow = !showHow">
            <mat-icon>info_outline</mat-icon> How It Works
          </a>
        </div>

        <div class="how-section" *ngIf="showHow">
          <div class="how-step" *ngFor="let step of steps; let i = index">
            <span class="step-num">{{ i + 1 }}</span>
            <div>
              <strong>{{ step.title }}</strong>
              <p>{{ step.desc }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ---- Mini Header ---- */
    .mini-header {
      background: linear-gradient(135deg, #1a237e 0%, #0d47a1 100%);
      padding: 12px 0;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .mini-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .mini-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mini-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.2);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700;
      flex-shrink: 0;
    }
    .mini-avatar mat-icon {
      font-size: 18px; width: 18px; height: 18px;
    }
    .mini-avatar-pulse {
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .mini-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .mini-name {
      color: #fff;
      font-size: 16px;
      font-weight: 600;
    }
    .mini-board {
      background: rgba(255,255,255,0.2);
      color: #fff;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .mini-status {
      color: rgba(255,255,255,0.7);
      font-size: 12px;
    }
    .mini-reset-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;
      font-family: 'Roboto', sans-serif;
    }
    .mini-reset-btn:hover { background: rgba(255,255,255,0.25); }
    .mini-reset-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    @media (max-width: 600px) {
      .mini-reset-text { display: none; }
      .mini-meta { gap: 6px; }
      .mini-name { font-size: 14px; }
    }

    /* ---- Full Hero ---- */
    .hero {
      background: linear-gradient(135deg, #1a237e 0%, #0d47a1 100%);
      border-radius: 0 0 24px 24px;
      padding: 48px 24px 40px;
      color: #fff;
      text-align: center;
    }
    .hero-content { max-width: 600px; margin: 0 auto; }
    .hero-badge {
      display: inline-block;
      background: rgba(255,255,255,0.15);
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 13px;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 32px;
      font-weight: 700;
      line-height: 1.2;
      margin: 0 0 12px;
    }
    .hero-sub {
      font-size: 15px;
      line-height: 1.6;
      opacity: 0.9;
      margin: 0 0 28px;
    }
    .input-row {
      display: flex;
      gap: 10px;
      background: #fff;
      border-radius: 14px;
      padding: 6px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
    .input-wrapper {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
    }
    .input-icon { color: #9e9e9e; font-size: 20px; width: 20px; height: 20px; }
    .url-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 15px;
      color: #212121;
      background: transparent;
      padding: 12px 0;
      font-family: 'Roboto', sans-serif;
    }
    .url-input::placeholder { color: #bdbdbd; }
    .primary-btn {
      background: #0d47a1;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.2s;
      font-family: 'Roboto', sans-serif;
    }
    .primary-btn:hover:not(:disabled) { background: #1565c0; }
    .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error-text {
      color: #ffcdd2;
      font-size: 13px;
      margin: 10px 0 0;
    }
    .hero-actions { margin-top: 20px; }
    .link-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: rgba(255,255,255,0.8);
      font-size: 14px;
      cursor: pointer;
      transition: color 0.2s;
    }
    .link-btn:hover { color: #fff; }
    .link-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .how-section {
      margin-top: 20px;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .how-step {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: rgba(255,255,255,0.08);
      padding: 14px 16px;
      border-radius: 10px;
    }
    .step-num {
      background: rgba(255,255,255,0.2);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .how-step strong { font-size: 14px; }
    .how-step p { margin: 4px 0 0; font-size: 13px; opacity: 0.85; line-height: 1.4; }
    @media (max-width: 600px) {
      .hero { padding: 32px 16px; }
      h1 { font-size: 26px; }
      .input-row { flex-direction: column; }
      .primary-btn { width: 100%; padding: 14px; }
    }
  `],
})
export class ScanInputComponent {
  @Input() compact = false;
  @Input() schoolName = '';
  @Input() board = '';
  @Input() scanStatus: ScanStatus = 'Classifying';
  @Output() scanUrl = new EventEmitter<string>();
  @Output() reset = new EventEmitter<void>();

  url = '';
  scanning = false;
  error = '';
  showHow = false;

  steps = [
    { title: 'Paste the school website', desc: 'Enter any school\'s website address above.' },
    { title: 'We read the website', desc: 'We check what information the school shares publicly for parents.' },
    { title: 'Get a clear summary', desc: 'See how transparent the school is about safety, fees, admissions, and more.' },
  ];

  get initials(): string {
    if (!this.schoolName) return '?';
    return this.schoolName
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  get statusLabel(): string {
    switch (this.scanStatus) {
      case 'Classifying': return 'Checking website...';
      case 'Crawling': return 'Reading pages...';
      case 'Scoring': return 'Preparing summary...';
      default: return '';
    }
  }

  onScan() {
    if (!this.url.trim()) return;
    let testUrl = this.url.trim();
    if (!/^https?:\/\//i.test(testUrl)) testUrl = 'https://' + testUrl;
    try {
      new URL(testUrl);
    } catch {
      this.error = 'Please enter a valid school website address';
      return;
    }
    this.error = '';
    this.scanning = true;
    this.scanUrl.emit(testUrl);
  }

  onReset() {
    this.scanning = false;
    this.error = '';
    this.url = '';
    this.reset.emit();
  }
}
