import { Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { CrawledSchoolOption, ScanStatus } from '../models/scan.models';
import { ScanService } from '../services/scan.service';
import { normalizeSchoolUrl } from '../utils/url-normalizer';

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

        <div class="city-row">
          <div class="input-wrapper">
            <mat-icon class="input-icon">location_city</mat-icon>
            <input
              class="url-input"
              [(ngModel)]="city"
              placeholder="City or PIN code (e.g. Coimbatore, 641001)"
              (ngModelChange)="onCityInputChange($event)"
              (keyup.enter)="onCitySearch()" />
          </div>
          <button class="ghost-search-btn" (click)="onCitySearch()" [disabled]="cityLoading">Find Schools</button>
        </div>
        <div class="city-dropdown" *ngIf="showCityDropdown">
          <div class="city-state" *ngIf="cityLoading">Searching crawled schools...</div>
          <div class="city-state" *ngIf="!cityLoading && cityResults.length === 0">No crawled schools found for this query.</div>
          <button
            type="button"
            class="city-option"
            *ngFor="let school of cityResults"
            (mousedown)="onSelectSchool(school)">
            <span class="school-name">{{ school.name }}</span>
            <span class="school-meta">{{ school.city || '-' }}, {{ school.state || '-' }}{{ school.pincode ? ' - ' + school.pincode : '' }}</span>
          </button>
        </div>

        <div class="or-divider"><span>or paste a school URL directly</span></div>

        <div class="input-row">
          <div class="input-wrapper">
            <mat-icon class="input-icon">language</mat-icon>
            <input
              class="url-input"
              [(ngModel)]="url"
              placeholder="Paste any Indian school website URL"
              (keyup.enter)="onScan()" />
          </div>
          <button class="primary-btn" [disabled]="!url.trim() || scanning" (click)="onScan()">
            {{ scanning ? 'Checking...' : 'Check School' }}
          </button>
        </div>

        <p class="tagline-sub">Get an honest analysis in 30 seconds.</p>
        <p *ngIf="error" class="error-text">{{ error }}</p>
        <p *ngIf="infoMessage" class="info-message">{{ infoMessage }}</p>

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
    .city-row {
      display: flex;
      gap: 10px;
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 14px;
      padding: 6px;
      margin-bottom: 0;
    }
    .ghost-search-btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.4);
      color: #fff;
      border-radius: 10px;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      font-family: 'Roboto', sans-serif;
      transition: background 0.2s;
    }
    .ghost-search-btn:hover { background: rgba(255,255,255,0.3); }
    .city-row .url-input { color: #fff; }
    .city-row .url-input::placeholder { color: rgba(255,255,255,0.6); }
    .city-row .input-icon { color: rgba(255,255,255,0.7); }
    .city-dropdown {
      margin-top: 8px;
      margin-bottom: 2px;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.32);
      background: rgba(13, 71, 161, 0.92);
      text-align: left;
      max-height: 280px;
      overflow-y: auto;
    }
    .city-state {
      font-size: 13px;
      color: rgba(255,255,255,0.88);
      padding: 12px;
    }
    .city-option {
      width: 100%;
      text-align: left;
      border: 0;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      background: transparent;
      color: #fff;
      cursor: pointer;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .city-option:last-child { border-bottom: 0; }
    .city-option:hover { background: rgba(255,255,255,0.12); }
    .school-name { font-size: 14px; font-weight: 600; line-height: 1.3; }
    .school-meta { font-size: 12px; color: rgba(255,255,255,0.75); line-height: 1.3; }
    .or-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      color: rgba(255,255,255,0.5);
      font-size: 12px;
      margin: 10px 0;
    }
    .or-divider::before, .or-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255,255,255,0.2);
    }
    .tagline-sub {
      color: rgba(255,255,255,0.75);
      font-size: 13px;
      margin: 10px 0 0;
    }
    .info-message {
      color: rgba(255,255,255,0.85);
      font-size: 13px;
      margin: 8px 0 0;
      background: rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 8px 12px;
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
export class ScanInputComponent implements OnDestroy {
  private readonly scanService = inject(ScanService);

  @Input() compact = false;
  @Input() schoolName = '';
  @Input() board = '';
  @Input() scanStatus: ScanStatus = 'Classifying';
  @Output() scanUrl = new EventEmitter<string>();
  @Output() reset = new EventEmitter<void>();

  url = '';
  city = '';
  infoMessage = '';
  scanning = false;
  error = '';
  showHow = false;
  cityLoading = false;
  cityResults: CrawledSchoolOption[] = [];
  showCityDropdown = false;

  private citySearchDebounce: number | null = null;
  private citySearchSub: Subscription | null = null;
  private cityRequestSerial = 0;

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
      case 'Uncertain': return 'Needs quick review...';
      default: return '';
    }
  }

  onScan() {
    if (!this.url.trim()) return;

    const norm = normalizeSchoolUrl(this.url);
    
    // Handle validation / error cases from normalizer
    if (norm.error) {
      this.error = norm.error;
      this.infoMessage = '';
      return;
    }

    // Update the input to show the clean domain
    this.url = norm.normalized;
    this.error = '';

    // If there was a major cleanup, we show a message and pause so they can edit.
    if (norm.wasGoogleAd || norm.hadTrackingParams || norm.hadDeepLink) {
      this.infoMessage = 'We cleaned up the link to the root domain. Edit if needed, or click Check School again to proceed.';
      // Do not auto-submit if it was deeply modified (gives option to edit)
      // We know it is safe to proceed next click because tracking/deeplinks are gone
      return; 
    }

    this.infoMessage = '';
    this.scanning = true;
    
    let testUrl = this.url.trim();
    if (!/^https?:\/\//i.test(testUrl)) testUrl = 'https://' + testUrl;

    this.scanUrl.emit(testUrl);
  }

  onCitySearch() {
    const query = this.city.trim();
    if (!query) {
      this.showCityDropdown = false;
      this.cityResults = [];
      return;
    }
    this.lookupSchools(query);
  }

  onCityInputChange(value: string) {
    this.city = value;
    const query = value.trim();

    if (this.citySearchDebounce !== null) {
      window.clearTimeout(this.citySearchDebounce);
      this.citySearchDebounce = null;
    }

    if (query.length < 2) {
      this.cityLoading = false;
      this.cityResults = [];
      this.showCityDropdown = false;
      return;
    }

    this.citySearchDebounce = window.setTimeout(() => {
      this.lookupSchools(query);
    }, 300);
  }

  onSelectSchool(school: CrawledSchoolOption) {
    this.url = school.websiteUrl;
    this.city = `${school.name}, ${school.city || '-'}, ${school.state || '-'}`;
    this.cityResults = [];
    this.showCityDropdown = false;
    this.cityLoading = false;
    this.infoMessage = `Selected ${school.name}. Starting scan from stored website URL.`;
    this.error = '';
    this.onScan();
  }

  onReset() {
    this.scanning = false;
    this.error = '';
    this.url = '';
    this.city = '';
    this.infoMessage = '';
    this.cityLoading = false;
    this.cityResults = [];
    this.showCityDropdown = false;
    this.reset.emit();
  }

  ngOnDestroy() {
    if (this.citySearchDebounce !== null) {
      window.clearTimeout(this.citySearchDebounce);
      this.citySearchDebounce = null;
    }
    this.citySearchSub?.unsubscribe();
    this.citySearchSub = null;
  }

  private lookupSchools(query: string) {
    this.citySearchSub?.unsubscribe();
    this.citySearchSub = null;
    this.cityLoading = true;
    this.showCityDropdown = true;
    this.infoMessage = '';

    const serial = ++this.cityRequestSerial;
    this.citySearchSub = this.scanService.searchCrawledSchools(query).subscribe({
      next: (res) => {
        if (serial !== this.cityRequestSerial) return;
        this.cityLoading = false;
        this.cityResults = res.items || [];
        this.showCityDropdown = true;
      },
      error: () => {
        if (serial !== this.cityRequestSerial) return;
        this.cityLoading = false;
        this.cityResults = [];
        this.showCityDropdown = false;
        this.infoMessage = 'Could not load school suggestions right now. You can still paste URL directly.';
      },
    });
  }
}

