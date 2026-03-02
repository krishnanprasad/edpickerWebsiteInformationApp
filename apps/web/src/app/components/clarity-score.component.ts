import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ClarityScore } from '../models/scan.models';

interface ClaritySection {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  items: { label: string; found: boolean }[];
}

@Component({
  selector: 'app-clarity-score',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <ng-container *ngIf="score">
      <div *ngFor="let sec of sections" class="section-card" [id]="'section-' + sec.id">
        <div class="section-header">
          <span class="section-emoji">{{ sec.emoji }}</span>
          <div>
            <h3 class="section-title">{{ sec.title }}</h3>
            <p class="section-sub">{{ sec.subtitle }}</p>
          </div>
        </div>

        <div class="items">
          <div class="item-row" *ngFor="let item of sec.items">
            <mat-icon [class]="item.found ? 'item-icon found' : 'item-icon missing'">
              {{ item.found ? 'check_circle' : 'cancel' }}
            </mat-icon>
            <span class="item-label">{{ item.label }}</span>
            <button class="ask-ai-btn" (click)="onAskAi(item.label)">Ask AI</button>
            <span class="item-tag" [class]="item.found ? 'tag-found' : 'tag-missing'">
              {{ item.found ? 'Visible' : 'Not Clearly Mentioned' }}
            </span>
          </div>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    .section-card {
      background: #fff; border-radius: var(--sl-radius, 12px);
      padding: 24px; box-shadow: var(--sl-shadow);
      margin-bottom: 12px;
    }
    .section-card:last-child { margin-bottom: 0; }
    .section-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .section-emoji { font-size: 28px; }
    .section-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--sl-text, #212121); }
    .section-sub { margin: 2px 0 0; font-size: 13px; color: var(--sl-text-muted, #616161); }

    .items { display: flex; flex-direction: column; gap: 10px; }
    .item-row {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; border-radius: 10px; background: #fafafa;
    }
    .item-icon { font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; }
    .item-icon.found { color: var(--sl-green, #2e7d32); }
    .item-icon.missing { color: var(--sl-red, #c62828); }
    .item-label { flex: 1; font-size: 14px; color: var(--sl-text, #212121); font-weight: 500; }
    .item-tag {
      font-size: 11px; font-weight: 600; padding: 3px 10px;
      border-radius: 10px; white-space: nowrap;
    }
    .tag-found { background: #e8f5e9; color: #1b5e20; }
    .tag-missing { background: #fce4ec; color: #b71c1c; }

    .ask-ai-btn {
      background: #e8eaf6;
      color: var(--sl-primary, #1a237e);
      border: none;
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
      transition: background 0.2s;
    }
    .ask-ai-btn:hover { background: #c5cae9; }
  `],
})
export class ClarityScoreComponent {
  @Input() score: ClarityScore | null = null;
  @Output() askAi = new EventEmitter<string>();

  onAskAi(label: string) {
    this.askAi.emit('Tell me about ' + label);
  }

  get sections(): ClaritySection[] {
    if (!this.score) return [];
    return [
      {
        id: 'admissions',
        emoji: '📝',
        title: 'Admissions',
        subtitle: 'Can parents find admission details easily?',
        items: [
          { label: 'Admission dates & process', found: this.score.items.admissionDatesVisible },
        ],
      },
      {
        id: 'fees',
        emoji: '💰',
        title: 'Fees & Costs',
        subtitle: 'Is fee information transparent?',
        items: [
          { label: 'Fee structure / fee details', found: this.score.items.feeClarity },
        ],
      },
      {
        id: 'academics',
        emoji: '📚',
        title: 'Academics',
        subtitle: 'What academic information is shared?',
        items: [
          { label: 'Academic calendar', found: this.score.items.academicCalendar },
          { label: 'Results / achievements published', found: this.score.items.resultsPublished },
        ],
      },
      {
        id: 'digital',
        emoji: '🌐',
        title: 'Digital Presence & Contact',
        subtitle: 'How easy is it to reach the school?',
        items: [
          { label: 'Contact info & Google Map', found: this.score.items.contactAndMap },
        ],
      },
    ];
  }
}
