import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { SafetyScore, ClarityScore, ParentQuestion } from '../models/scan.models';

@Component({
  selector: 'app-parent-questions',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="questions-card" *ngIf="questions.length">
      <h3 class="card-title">
        <span class="title-emoji">❓</span>
        Questions You May Want to Ask
      </h3>
      <p class="card-sub">Based on what's missing from the website, you might want to bring these up during a school visit.</p>

      <ul class="q-list">
        <li *ngFor="let q of questions">
          <span class="q-icon">{{ q.icon }}</span>
          <span>{{ q.text }}</span>
        </li>
      </ul>
    </div>
  `,
  styles: [`
    .questions-card {
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      padding: 24px;
      box-shadow: var(--sl-shadow);
    }
    .card-title {
      display: flex; align-items: center; gap: 8px;
      margin: 0 0 6px; font-size: 18px; font-weight: 600;
      color: var(--sl-text, #212121);
    }
    .title-emoji { font-size: 22px; }
    .card-sub {
      margin: 0 0 18px; font-size: 13px;
      color: var(--sl-text-muted, #616161); line-height: 1.5;
    }
    .q-list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 10px;
    }
    .q-list li {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      background: #f5f5f5;
      font-size: 14px; color: var(--sl-text, #212121);
      line-height: 1.5;
    }
    .q-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
  `],
})
export class ParentQuestionsComponent {
  @Input() safetyScore: SafetyScore | null = null;
  @Input() clarityScore: ClarityScore | null = null;

  get questions(): ParentQuestion[] {
    const qs: ParentQuestion[] = [];
    if (!this.safetyScore && !this.clarityScore) return qs;

    const s = this.safetyScore;
    const c = this.clarityScore;

    if (s) {
      if (s.items.fireCertificate.status !== 'found')
        qs.push({ icon: '🔥', text: 'Does the school have a valid fire safety certificate? Can you see it during your visit?' });
      if (s.items.cctvMention.status !== 'found')
        qs.push({ icon: '📹', text: 'Is CCTV installed on campus? Are common areas and entry points covered?' });
      if (s.items.transportSafety.status !== 'found')
        qs.push({ icon: '🚌', text: 'What safety measures are in place for school transport? Is there a GPS tracker and attendant?' });
      if (s.items.antiBullyingPolicy.status !== 'found')
        qs.push({ icon: '🤝', text: 'Does the school have an anti-bullying policy? How are incidents handled?' });
    }

    if (c) {
      if (!c.items.feeClarity)
        qs.push({ icon: '💰', text: 'Can you share a detailed fee breakdown? Are there any hidden charges beyond tuition?' });
      if (!c.items.admissionDatesVisible)
        qs.push({ icon: '📝', text: 'When does the admission process start and what documents are required?' });
      if (!c.items.academicCalendar)
        qs.push({ icon: '📅', text: 'Is the academic calendar available? When are term exams and holidays scheduled?' });
    }

    return qs.slice(0, 5);
  }
}
