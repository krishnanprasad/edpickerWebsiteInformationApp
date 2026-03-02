import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  SafetyScore, ClarityScore, TransparencyLevel,
  getTransparencyLevel, getTransparencyColor,
} from '../models/scan.models';

@Component({
  selector: 'app-confidence-level',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="confidence-wrap">
      <div class="confidence-header">
        <span class="conf-emoji">🎯</span>
        <div>
          <p class="conf-label">Parent Confidence Level</p>
          <h2 class="conf-level" [style.color]="levelColor">{{ level }}</h2>
        </div>
      </div>

      <ul class="reasons-list">
        <li *ngFor="let r of reasons">
          <mat-icon [style.color]="r.positive ? '#2e7d32' : '#e65100'">
            {{ r.positive ? 'check_circle' : 'info' }}
          </mat-icon>
          <span>{{ r.text }}</span>
        </li>
      </ul>
      <p class="disclaimer">Based on publicly available website information.</p>
    </div>
  `,
  styles: [`
    .confidence-wrap {
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 24px;
      box-shadow: var(--sl-shadow);
    }
    .confidence-header {
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 20px;
    }
    .conf-emoji { font-size: 36px; }
    .conf-label {
      margin: 0; font-size: 13px;
      color: var(--sl-text-muted, #616161);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .conf-level { margin: 2px 0 0; font-size: 24px; font-weight: 700; }
    .reasons-list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 12px;
    }
    .reasons-list li {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 14px; color: var(--sl-text, #212121);
      line-height: 1.5;
    }
    .reasons-list mat-icon {
      font-size: 20px; width: 20px; height: 20px;
      flex-shrink: 0; margin-top: 1px;
    }
    .disclaimer {
      margin: 16px 0 0; font-size: 11px;
      color: #9e9e9e; text-align: center;
      font-style: italic;
    }
  `],
})
export class ConfidenceLevelComponent {
  @Input() overallScore = 0;
  @Input() safetyScore: SafetyScore | null = null;
  @Input() clarityScore: ClarityScore | null = null;

  get level(): TransparencyLevel {
    return getTransparencyLevel(this.overallScore);
  }

  get levelColor(): string {
    return getTransparencyColor(this.level);
  }

  get reasons(): { text: string; positive: boolean }[] {
    const list: { text: string; positive: boolean }[] = [];
    if (!this.safetyScore || !this.clarityScore) return list;

    const s = this.safetyScore;
    const c = this.clarityScore;

    // Safety-based reasons
    if (s.items.cctvMention.status === 'found') {
      list.push({ text: 'CCTV / surveillance is mentioned on the website', positive: true });
    } else {
      list.push({ text: 'No mention of CCTV or campus security was found', positive: false });
    }

    if (s.items.transportSafety.status === 'found') {
      list.push({ text: 'Transport safety information is available', positive: true });
    } else {
      list.push({ text: 'Transport safety details are missing from the website', positive: false });
    }

    if (s.items.antiBullyingPolicy.status === 'found') {
      list.push({ text: 'The school mentions an anti-bullying policy', positive: true });
    } else {
      list.push({ text: 'No anti-bullying policy was found online', positive: false });
    }

    // Clarity-based reasons
    if (c.items.feeClarity) {
      list.push({ text: 'Fee information is visible on the website', positive: true });
    } else {
      list.push({ text: 'Fee details are not shared on the website', positive: false });
    }

    if (c.items.admissionDatesVisible) {
      list.push({ text: 'Admission dates and process are clearly listed', positive: true });
    } else {
      list.push({ text: 'Admission dates and process are not visible', positive: false });
    }

    return list.slice(0, 5);
  }
}
