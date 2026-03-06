import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface CrashEvent {
  title: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class CrashHandlerService {
  private readonly crashSubject = new Subject<CrashEvent>();
  private isLatched = false;

  readonly crash$ = this.crashSubject.asObservable();

  report(message: string, title = 'We are repairing it'): void {
    if (this.isLatched) return;
    this.isLatched = true;
    this.crashSubject.next({ title, message });
  }

  clear(): void {
    this.isLatched = false;
  }
}

