import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { CrashHandlerService } from './crash-handler.service';

export const httpCrashInterceptor: HttpInterceptorFn = (req, next) => {
  const crashHandler = inject(CrashHandlerService);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        if (err.status === 0 || err.status >= 500) {
          crashHandler.report('Our systems hit a snag. Please return to Home while we fix it.');
        }
      } else {
        crashHandler.report('Something unexpected happened. Please return to Home while we fix it.');
      }
      return throwError(() => err);
    }),
  );
};

