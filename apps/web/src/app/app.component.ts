import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <main style="max-width: 900px; margin: 24px auto; padding: 0 12px; display: grid; gap: 16px;">
      <h1>SchoolLens (Angular 17)</h1>
      <mat-card>
        <h3>1) Scan URL</h3>
        <mat-form-field appearance="outline" style="width: 100%;">
          <mat-label>School URL</mat-label>
          <input matInput [(ngModel)]="url" placeholder="https://example.edu" />
        </mat-form-field>
        <button mat-raised-button color="primary" (click)="scan()">Scan</button>
        <p>{{status}}</p>
      </mat-card>

      <mat-card *ngIf="sessionId">
        <h3>2) Ask Question</h3>
        <mat-form-field appearance="outline" style="width:100%;">
          <mat-label>Question</mat-label>
          <textarea matInput [(ngModel)]="question"></textarea>
        </mat-form-field>
        <button mat-raised-button color="accent" (click)="ask()">Ask</button>
        <p><strong>Answer:</strong> {{answer}}</p>
      </mat-card>
    </main>
  `,
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  url = '';
  question = '';
  answer = '';
  status = '';
  sessionId = '';

  async scan() {
    this.status = 'Scanning...';
    const response = await this.http.post<{ sessionId: string }>('/api/scan', { url: this.url }).toPromise();
    this.sessionId = response?.sessionId || '';
    this.status = this.sessionId ? `Queued: ${this.sessionId}` : 'Scan submitted';
  }

  async ask() {
    if (!this.sessionId) return;
    const response = await this.http.post<{ answer: string }>(`/api/scan/${this.sessionId}/ask`, { question: this.question }).toPromise();
    this.answer = response?.answer || 'No answer';
  }
}
