import { Component, Input, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ScanService } from '../services/scan.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  citations?: { pageUrl: string; excerpt: string }[];
}

@Component({
  selector: 'app-ask-box',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="ask-card" [class.disabled]="!enabled">
      <h3 class="card-title">
        <span class="title-emoji">💬</span>
        Ask About This School
      </h3>
      <p class="card-sub" *ngIf="!enabled">
        Questions will be available once analysis is complete.
      </p>
      <p class="card-sub" *ngIf="enabled">
        Ask anything and we'll find the answer from the school's website.
      </p>

      <div class="suggestion-chips">
        <button class="chip" *ngFor="let s of currentSuggestions"
                [disabled]="!enabled || loading"
                (click)="useSuggestion(s)">
          {{ s }}
        </button>
      </div>

      <div class="chat-messages" *ngIf="messages.length">
        <div *ngFor="let msg of messages" class="chat-msg" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
          <div class="msg-bubble">
            <p class="msg-text">{{ msg.text }}</p>
            <div class="citations" *ngIf="msg.citations?.length">
              <p class="cite-label">Sources:</p>
              <a *ngFor="let c of msg.citations" [href]="c.pageUrl" target="_blank" class="cite-link">
                {{ c.pageUrl | slice:0:50 }}
              </a>
            </div>
          </div>
        </div>
      </div>

      <div class="input-row" *ngIf="enabled">
        <input
          class="ask-input"
          [(ngModel)]="question"
          placeholder="e.g. What is the admission process?"
          (keyup.enter)="submitQuestion()" />
        <button class="send-btn" [disabled]="!question.trim() || loading" (click)="submitQuestion()">
          <mat-icon>{{ loading ? 'hourglass_empty' : 'send' }}</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .ask-card {
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 24px;
      box-shadow: var(--sl-shadow);
      transition: opacity 0.3s;
    }
    .ask-card.disabled { opacity: 0.6; }
    .card-title {
      display: flex; align-items: center; gap: 8px;
      margin: 0 0 6px; font-size: 18px; font-weight: 600;
      color: var(--sl-text, #212121);
    }
    .title-emoji { font-size: 22px; }
    .card-sub {
      margin: 0 0 16px; font-size: 13px;
      color: var(--sl-text-muted, #616161); line-height: 1.5;
    }
    .suggestion-chips {
      display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .chip {
      padding: 6px 14px; border-radius: 16px;
      background: #e8eaf6; color: var(--sl-primary, #1a237e);
      border: none; font-size: 12px; font-weight: 500;
      cursor: pointer; transition: background 0.2s;
      font-family: 'Roboto', sans-serif;
    }
    .chip:hover:not(:disabled) { background: #c5cae9; }
    .chip:disabled { opacity: 0.5; cursor: not-allowed; }

    .chat-messages {
      max-height: 360px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 10px;
      margin-bottom: 14px;
      padding-right: 4px;
    }
    .chat-msg { display: flex; }
    .chat-msg.user { justify-content: flex-end; }
    .chat-msg.assistant { justify-content: flex-start; }
    .msg-bubble {
      max-width: 85%; padding: 10px 14px;
      border-radius: 12px; font-size: 13px; line-height: 1.5;
    }
    .chat-msg.user .msg-bubble {
      background: var(--sl-primary, #1a237e); color: #fff;
      border-bottom-right-radius: 4px;
    }
    .chat-msg.assistant .msg-bubble {
      background: #f5f5f5; color: var(--sl-text, #212121);
      border-bottom-left-radius: 4px;
    }
    .msg-text { margin: 0; white-space: pre-wrap; }
    .citations { margin-top: 8px; }
    .cite-label { margin: 0 0 2px; font-size: 10px; color: #9e9e9e; text-transform: uppercase; letter-spacing: 0.5px; }
    .cite-link {
      display: block; font-size: 11px;
      color: var(--sl-accent, #0d47a1);
      text-decoration: none; margin-bottom: 1px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cite-link:hover { text-decoration: underline; }

    .input-row {
      display: flex; gap: 8px;
      background: #f5f5f5; border-radius: 12px;
      padding: 4px 4px 4px 16px;
    }
    .ask-input {
      flex: 1; border: none; outline: none;
      background: transparent; font-size: 14px;
      color: var(--sl-text, #212121);
      padding: 10px 0;
      font-family: 'Roboto', sans-serif;
    }
    .ask-input::placeholder { color: #bdbdbd; }
    .send-btn {
      width: 40px; height: 40px; border-radius: 10px;
      background: var(--sl-primary, #1a237e); color: #fff;
      border: none; cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .send-btn:hover:not(:disabled) { background: var(--sl-accent, #0d47a1); }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .send-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class AskBoxComponent implements OnChanges {
  @Input() sessionId = '';
  @Input() activeCategory = 'safety';
  @Input() enabled = false;

  private readonly scanService = inject(ScanService);

  question = '';
  loading = false;
  messages: ChatMessage[] = [];

  private categoryChips: Record<string, string[]> = {
    safety: [
      'Is CCTV installed?',
      'Is there a fire certificate?',
      'Are buses GPS-enabled?',
    ],
    fees: [
      'What are the total fees?',
      'Any hidden charges?',
      'Is there a fee refund policy?',
    ],
    admissions: [
      'What documents are needed?',
      'When does admission open?',
      'Is there an entrance test?',
    ],
    academics: [
      'What curriculum is followed?',
      'What are the school timings?',
      'Any special programs?',
    ],
    digital: [
      'Is there an online portal?',
      'How to contact the school?',
      'Is a campus map available?',
    ],
  };

  private defaultChips = [
    'What about safety?',
    'What are the fees?',
    'How is admission done?',
    'Tell me about academics',
  ];

  currentSuggestions: string[] = this.defaultChips;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['activeCategory']) {
      this.currentSuggestions = this.categoryChips[this.activeCategory] || this.defaultChips;
    }
  }

  useSuggestion(s: string) {
    if (!this.enabled || this.loading) return;
    this.question = s;
    this.submitQuestion();
  }

  /** External call: set question and submit */
  askQuestion(q: string) {
    if (!this.enabled || this.loading) return;
    this.question = q;
    this.submitQuestion();
  }

  submitQuestion() {
    if (!this.question.trim() || this.loading || !this.sessionId || !this.enabled) return;
    const q = this.question.trim();
    this.question = '';
    this.loading = true;

    this.messages.push({ role: 'user', text: q });

    this.scanService.ask(this.sessionId, q).subscribe({
      next: (res) => {
        this.messages.push({
          role: 'assistant',
          text: res.answer,
          citations: res.citations,
        });
        this.loading = false;
      },
      error: () => {
        this.messages.push({
          role: 'assistant',
          text: 'Sorry, we couldn\'t find an answer. Please try a different question.',
        });
        this.loading = false;
      },
    });
  }
}
