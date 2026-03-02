import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Category {
  id: string;
  label: string;
  emoji: string;
}

@Component({
  selector: 'app-category-scroller',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="scroller-wrap">
      <div class="scroller hide-scrollbar">
        <button
          *ngFor="let cat of categories"
          class="cat-chip"
          [class.active]="activeId === cat.id"
          (click)="selectCategory(cat)">
          <span class="chip-emoji">{{ cat.emoji }}</span>
          <span>{{ cat.label }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .scroller-wrap {
      position: sticky; top: 0; z-index: 10;
      background: var(--sl-bg, #f8f9fa);
      padding: 12px 0;
    }
    .scroller {
      display: flex; gap: 8px;
      overflow-x: auto; padding: 0 16px;
      -webkit-overflow-scrolling: touch;
    }
    .cat-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 20px;
      background: #fff;
      border: 1.5px solid #e0e0e0;
      font-size: 13px; font-weight: 500;
      color: var(--sl-text, #212121);
      cursor: pointer; white-space: nowrap;
      transition: all 0.2s;
      font-family: 'Roboto', sans-serif;
    }
    .cat-chip:hover { border-color: var(--sl-primary, #1a237e); }
    .cat-chip.active {
      background: var(--sl-primary, #1a237e);
      border-color: var(--sl-primary, #1a237e);
      color: #fff;
    }
    .chip-emoji { font-size: 15px; }
  `],
})
export class CategoryScrollerComponent {
  @Input() activeId = 'safety';
  @Output() categorySelect = new EventEmitter<string>();

  categories: Category[] = [
    { id: 'safety', label: 'Safety', emoji: '🛡️' },
    { id: 'admissions', label: 'Admissions', emoji: '📝' },
    { id: 'fees', label: 'Fees', emoji: '💰' },
    { id: 'academics', label: 'Academics', emoji: '📚' },
    { id: 'digital', label: 'Contact & Digital', emoji: '🌐' },
  ];

  selectCategory(cat: Category) {
    this.activeId = cat.id;
    this.categorySelect.emit(cat.id);
    const el = document.getElementById('section-' + cat.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
