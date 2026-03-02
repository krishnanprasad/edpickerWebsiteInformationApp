import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { SafetyScore, SafetyItem } from '../models/scan.models';

@Component({
  selector: 'app-safety-score',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="section-card" id="section-safety" *ngIf="score">
      <div class="section-header">
        <span class="section-emoji">🛡️</span>
        <div>
          <h3 class="section-title">Safety &amp; Security</h3>
          <p class="section-sub">What the school shares about campus safety</p>
        </div>
      </div>

      <div class="items">
        <div class="item-row" *ngFor="let item of items">
          <mat-icon [class]="'item-icon ' + iconClass(item.data)">
            {{ icon(item.data) }}
          </mat-icon>
          <div class="item-info">
            <span class="item-label">{{ item.label }}</span>
            <span class="item-evidence" *ngIf="item.data.evidence">{{ item.data.evidence }}</span>
          </div>
          <button class="ask-ai-btn" (click)="onAskAi(item.label)">Ask AI</button>
          <span class="item-tag" [class]="tagClass(item.data)" [title]="evidenceTooltip(item.data)">
            {{ tagLabel(item.data) }}
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .section-card {
      background: #fff; border-radius: var(--sl-radius, 12px);
      padding: 24px; box-shadow: var(--sl-shadow);
    }
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
    .item-icon.icon-found { color: var(--sl-green, #2e7d32); }
    .item-icon.icon-unclear { color: var(--sl-amber, #e65100); }
    .item-icon.icon-missing { color: var(--sl-red, #c62828); }
    .item-info { flex: 1; display: flex; flex-direction: column; }
    .item-label { font-size: 14px; color: var(--sl-text, #212121); font-weight: 500; }
    .item-evidence { font-size: 12px; color: var(--sl-text-muted, #616161); margin-top: 2px; }
    .item-tag {
      font-size: 11px; font-weight: 600; padding: 3px 10px;
      border-radius: 10px; white-space: nowrap;
    }
    .tag-found { background: #e8f5e9; color: #1b5e20; }
    .tag-unclear { background: #fff3e0; color: #e65100; }
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
export class SafetyScoreComponent {
  @Input() score: SafetyScore | null = null;
  @Output() askAi = new EventEmitter<string>();

  get items(): { label: string; data: SafetyItem }[] {
    if (!this.score) return [];
    return [
      { label: 'Fire Safety Certificate', data: this.score.items.fireCertificate },
      { label: 'Sanitary / Health Certificate', data: this.score.items.sanitaryCertificate },
      { label: 'CCTV / Surveillance', data: this.score.items.cctvMention },
      { label: 'Transport Safety', data: this.score.items.transportSafety },
      { label: 'Anti-Bullying Policy', data: this.score.items.antiBullyingPolicy },
    ];
  }

  icon(item: SafetyItem): string {
    return item.status === 'found' ? 'check_circle' : item.status === 'unclear' ? 'help_outline' : 'cancel';
  }
  iconClass(item: SafetyItem): string { return 'icon-' + item.status; }
  tagLabel(item: SafetyItem): string {
    return item.status === 'found' ? 'Mentioned' : item.status === 'unclear' ? 'Unclear' : 'Not Clearly Mentioned';
  }
  tagClass(item: SafetyItem): string { return 'tag-' + item.status; }

  evidenceTooltip(item: SafetyItem): string {
    if (!item.evidence) return '';
    return 'Source: ' + item.evidence;
  }

  onAskAi(label: string) {
    this.askAi.emit('Does the school have ' + label + '?');
  }
}
