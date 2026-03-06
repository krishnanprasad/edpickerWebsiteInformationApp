import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Classification } from '../models/scan.models';

@Component({
  selector: 'app-classification-check',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="reject-wrap" *ngIf="classification && !classification.isEducational">
      <div class="reject-card">
        <div class="reject-header">
          <span class="reject-emoji">!</span>
          <h2>{{ title }}</h2>
        </div>

        <p class="parent-note">{{ parentNote }}</p>

        <div class="reasons-section">
          <h4>Here is what we noticed:</h4>
          <ul class="reasons-list">
            <li *ngFor="let reason of getReasons()">
              <mat-icon class="reason-icon">arrow_forward</mat-icon>
              <span>{{ reason }}</span>
            </li>
          </ul>
        </div>

        <div class="keywords-row" *ngIf="classification.matchedKeywords?.length">
          <span class="kw-label">Terms found:</span>
          <span class="kw-chip" *ngFor="let kw of classification.matchedKeywords">{{ kw }}</span>
        </div>

        <div class="tip-box">
          <mat-icon>lightbulb</mat-icon>
          <span>
            <strong>For school administrators:</strong> Adding clear information about
            admissions, curriculum, and board affiliation helps parents find and trust your school.
          </span>
        </div>

        <button class="try-again-btn" (click)="retry.emit()">Try Another School</button>
      </div>
    </div>
  `,
  styles: [`
    .reject-wrap {
      padding: 24px 16px;
      max-width: 600px;
      margin: 0 auto;
    }
    .reject-card {
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 28px 24px;
      box-shadow: var(--sl-shadow);
    }
    .reject-header {
      display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
    }
    .reject-emoji { font-size: 28px; }
    .reject-header h2 {
      margin: 0; font-size: 20px; font-weight: 600;
      color: var(--sl-amber, #e65100);
    }
    .parent-note {
      background: #fff8e1; border-left: 4px solid #ffb300;
      padding: 14px 16px; border-radius: 0 10px 10px 0;
      color: #4e342e; font-size: 14px; line-height: 1.7;
      margin: 0 0 20px;
    }
    .reasons-section h4 {
      font-size: 15px; color: var(--sl-text, #212121);
      margin: 0 0 10px; font-weight: 600;
    }
    .reasons-list {
      list-style: none; padding: 0; margin: 0 0 20px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .reasons-list li {
      display: flex; align-items: flex-start; gap: 8px;
      font-size: 13.5px; color: #455a64; line-height: 1.5;
    }
    .reason-icon {
      font-size: 16px; width: 16px; height: 16px;
      color: var(--sl-amber, #e65100); flex-shrink: 0; margin-top: 2px;
    }
    .keywords-row {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .kw-label { font-size: 12px; color: #78909c; }
    .kw-chip {
      display: inline-block; background: #e8f5e9; color: #2e7d32;
      padding: 3px 10px; border-radius: 12px; font-size: 12px;
    }
    .tip-box {
      display: flex; align-items: flex-start; gap: 8px;
      background: #e3f2fd; padding: 12px 14px; border-radius: 10px;
      font-size: 13px; color: #1565c0; line-height: 1.5;
      margin-bottom: 20px;
    }
    .tip-box mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    .try-again-btn {
      display: block; width: 100%;
      background: var(--sl-primary, #1a237e); color: #fff;
      border: none; border-radius: 10px; padding: 14px;
      font-size: 15px; font-weight: 500; cursor: pointer;
      transition: background 0.2s;
      font-family: 'Roboto', sans-serif;
    }
    .try-again-btn:hover { background: var(--sl-accent, #0d47a1); }
  `],
})
export class ClassificationCheckComponent {
  @Input() classification: Classification | null = null;
  @Input() status: 'Rejected' | 'Uncertain' = 'Rejected';
  @Output() retry = new EventEmitter<void>();

  get title(): string {
    return this.status === 'Uncertain'
      ? 'We Need a Quick Review for This School'
      : 'We Could Not Verify This as a School';
  }

  get parentNote(): string {
    if (this.status === 'Uncertain') {
      return 'This website shows some school-like signals, but not enough clear educational information yet. It may still be a valid school site.';
    }
    return 'We were not able to find enough educational information on this website to prepare a useful summary for you. This does not mean the school is bad.';
  }

  getReasons(): string[] {
    if (!this.classification) return [];
    if (this.classification.rejectionReasons?.length) {
      return this.classification.rejectionReasons.slice(0, 5);
    }
    const reasons: string[] = [];
    const matched = this.classification.matchedKeywords ?? [];
    if (matched.length === 0) {
      reasons.push('No school-related terms were found on this website.');
    } else {
      reasons.push(
        `Only ${matched.length} educational term(s) detected (${matched.slice(0, 4).join(', ')}). Verified schools typically show many more.`
      );
    }
    reasons.push('The website may use pop-ups or JavaScript that prevents reading content.');
    reasons.push('We could not find clear information about admissions, curriculum, or board affiliation.');
    reasons.push('The site may be a coaching center, business portal, or non-school service.');
    reasons.push('If this is a real school, the website might benefit from clearer information for parents.');
    return reasons.slice(0, 5);
  }
}
