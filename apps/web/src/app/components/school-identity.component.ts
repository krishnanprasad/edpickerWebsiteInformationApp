import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  SchoolIdentity, TransparencyLevel,
  getTransparencyLevel, getTransparencyColor,
} from '../models/scan.models';

@Component({
  selector: 'app-school-identity',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="id-card" *ngIf="identity">
      <div class="card-top">
        <div class="school-avatar">{{ initials }}</div>
        <div class="school-meta">
          <h2 class="school-name">{{ identity.name }}</h2>
          <div class="meta-chips">
            <span class="board-badge" *ngIf="identity.board">{{ identity.board }}</span>
            <span class="year-badge" *ngIf="identity.foundingYear">Est. {{ identity.foundingYear }}</span>
          </div>
        </div>
      </div>

      <!-- Principal -->
      <div class="info-row fade-in">
        <mat-icon>person</mat-icon>
        <span class="info-label">Principal:</span>
        <span class="info-value" [class.info-empty]="!identity.principal || identity.principal.includes('Not Able to Identify')">{{ identity.principal || 'Not Able to Identify - Missing Data.' }}</span>
      </div>

      <!-- Phone -->
      <div class="info-row fade-in" *ngIf="displayPhones.length">
        <mat-icon>phone</mat-icon>
        <span class="info-label">{{ displayPhones.length > 1 ? 'Phones:' : 'Phone:' }}</span>
        <span class="info-value phones-wrap">
          <a class="info-link phone-chip" *ngFor="let ph of displayPhones" [href]="'tel:' + ph">{{ ph }}</a>
        </span>
      </div>

      <!-- Email -->
      <div class="info-row fade-in" *ngIf="identity.email">
        <mat-icon>email</mat-icon>
        <span class="info-label">Email:</span>
        <a class="info-value info-link" [href]="'mailto:' + identity.email">{{ identity.email }}</a>
      </div>

      <!-- Social links -->
      <div class="social-row fade-in" *ngIf="identity.socialUrls && hasSocials">
        <a class="social-icon" *ngIf="identity.socialUrls.facebook" [href]="identity.socialUrls.facebook" target="_blank" title="Facebook">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#1877F2" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg>
        </a>
        <a class="social-icon" *ngIf="identity.socialUrls.youtube" [href]="identity.socialUrls.youtube" target="_blank" title="YouTube">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.377.504A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.504 9.376.504 9.376.504s7.505 0 9.377-.504a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        </a>
        <a class="social-icon" *ngIf="identity.socialUrls.instagram" [href]="identity.socialUrls.instagram" target="_blank" title="Instagram">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#E4405F" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
        </a>
        <a class="social-icon" *ngIf="identity.socialUrls.twitter" [href]="identity.socialUrls.twitter" target="_blank" title="Twitter / X">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#000" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a class="social-icon" *ngIf="identity.socialUrls.linkedin" [href]="identity.socialUrls.linkedin" target="_blank" title="LinkedIn">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
      </div>

      <!-- Motto -->
      <div class="motto-row fade-in" *ngIf="identity.motto">
        <span class="motto-text">"{{ identity.motto }}"</span>
      </div>

      <!-- Vision -->
      <div class="vision-row fade-in">
        <span class="vision-label">Vision:</span>
        <span class="vision-text" *ngIf="identity.vision">{{ identity.vision }}</span>
        <span class="vision-text empty" *ngIf="!identity.vision">Not published on website</span>
      </div>

      <!-- Mission -->
      <div class="vision-row fade-in">
        <span class="vision-label">Mission:</span>
        <span class="vision-text" *ngIf="identity.mission">{{ identity.mission }}</span>
        <span class="vision-text empty" *ngIf="!identity.mission">Not published on website</span>
      </div>

      <div class="transparency-row" *ngIf="overallScore > 0">
        <span class="transp-label">Website Transparency:</span>
        <span class="transp-badge" [style.background]="transparencyBg" [style.color]="transparencyColor">
          {{ transparencyLevel }}
        </span>
      </div>

      <div class="action-buttons">
        <a class="action-btn" *ngIf="primaryPhone" [href]="'tel:' + primaryPhone">
          <mat-icon>phone</mat-icon> Call
        </a>
        <a class="action-btn" *ngIf="identity.email" [href]="'mailto:' + identity.email">
          <mat-icon>email</mat-icon> Email
        </a>
        <a class="action-btn" *ngIf="identity.address"
           [href]="'https://maps.google.com/?q=' + encodeAddr()" target="_blank">
          <mat-icon>place</mat-icon> Directions
        </a>
        <a class="action-btn" [href]="identity.websiteUrl" target="_blank">
          <mat-icon>language</mat-icon> Website
        </a>
      </div>

      <p class="address-line" *ngIf="identity.address">
        <mat-icon>location_on</mat-icon> {{ identity.address }}
      </p>
    </div>
  `,
  styles: [`
    .id-card {
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 24px;
      box-shadow: var(--sl-shadow);
    }
    .card-top { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .school-avatar {
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #1a237e, #0d47a1);
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 700; flex-shrink: 0;
    }
    .school-meta { flex: 1; }
    .school-name {
      margin: 0 0 4px; font-size: 20px; font-weight: 700;
      color: var(--sl-text, #212121);
    }
    .meta-chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .board-badge {
      display: inline-block;
      background: #e8eaf6; color: #1a237e;
      padding: 3px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
    }
    .year-badge {
      display: inline-block;
      background: #f3e5f5; color: #6a1b9a;
      padding: 3px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 600;
    }

    .info-row {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 10px; font-size: 14px;
      color: var(--sl-text, #212121);
    }
    .info-row mat-icon { font-size: 18px; width: 18px; height: 18px; color: #1a237e; }
    .info-label { color: var(--sl-text-muted, #616161); font-weight: 500; }
    .info-value { font-weight: 600; }
    .info-empty { color: #8a8a8a; font-style: italic; font-weight: 500; }
    .phones-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
    .phone-chip { background: #f5f5f5; border-radius: 999px; padding: 2px 8px; text-decoration: none; }
    .info-link { color: #1a237e; text-decoration: none; cursor: pointer; }
    .info-link:hover { text-decoration: underline; }

    .social-row {
      display: flex; gap: 8px; margin-bottom: 14px;
      flex-wrap: wrap; align-items: center;
    }
    .social-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 0;
      background: transparent; transition: transform 0.15s;
      text-decoration: none;
    }
    .social-icon:hover { transform: scale(1.08); }
    .social-icon svg { display: block; }

    .vision-row {
      margin-bottom: 10px; font-size: 13px;
      line-height: 1.5;
      color: var(--sl-text, #212121);
    }
    .vision-label {
      font-weight: 600; color: var(--sl-text-muted, #616161);
      margin-right: 6px;
    }
    .vision-text { color: #424242; }
    .vision-text.empty { font-style: italic; color: #9e9e9e; }

    .motto-row {
      margin: 16px 0;
      padding-left: 16px;
      border-left: 3px solid #1a237e;
    }
    .motto-text {
      font-size: 15px;
      font-style: italic;
      color: #3f51b5;
      font-weight: 500;
      line-height: 1.4;
    }

    .transparency-row {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 16px; margin-top: 6px;
    }
    .transp-label { font-size: 13px; color: var(--sl-text-muted, #616161); }
    .transp-badge {
      display: inline-block; padding: 4px 14px;
      border-radius: 14px; font-size: 13px; font-weight: 600;
    }
    .action-buttons {
      display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap;
    }
    .action-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 8px 16px; border-radius: 20px;
      background: #f5f5f5; color: var(--sl-text, #212121);
      font-size: 13px; font-weight: 500;
      text-decoration: none; cursor: pointer;
      transition: background 0.2s;
    }
    .action-btn:hover { background: #e0e0e0; }
    .action-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .address-line {
      display: flex; align-items: flex-start; gap: 6px;
      font-size: 13px; color: var(--sl-text-muted, #616161);
      margin: 0; line-height: 1.4;
    }
    .address-line mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }

    .fade-in { animation: fadeSlideIn 0.4s ease-out; }
    @keyframes fadeSlideIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `],
})
export class SchoolIdentityComponent {
  @Input() identity: SchoolIdentity | null = null;
  @Input() overallScore = 0;

  get displayPhones(): string[] {
    if (!this.identity) return [];
    const phones = Array.isArray(this.identity.phones) ? this.identity.phones : [];
    const fallback = this.identity.phone ? [this.identity.phone] : [];
    return Array.from(new Set([...(phones || []), ...fallback].filter(Boolean) as string[])).slice(0, 3);
  }

  get primaryPhone(): string | null {
    return this.displayPhones[0] || null;
  }

  get initials(): string {
    if (!this.identity?.name) return '?';
    return this.identity.name
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  get hasSocials(): boolean {
    const s = this.identity?.socialUrls;
    return !!(s && (s.facebook || s.instagram || s.youtube || s.twitter || s.linkedin));
  }

  get transparencyLevel(): TransparencyLevel {
    return getTransparencyLevel(this.overallScore);
  }

  get transparencyColor(): string {
    return getTransparencyColor(this.transparencyLevel);
  }

  get transparencyBg(): string {
    switch (this.transparencyLevel) {
      case 'High': return '#e8f5e9';
      case 'Moderate': return '#fff3e0';
      case 'Low': return '#fce4ec';
    }
  }

  encodeAddr(): string {
    return encodeURIComponent(this.identity?.address || '');
  }
}
