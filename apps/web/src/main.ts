import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { httpCrashInterceptor } from './app/services/http-crash.interceptor';

bootstrapApplication(AppComponent, {
  providers: [provideAnimations(), provideHttpClient(withInterceptors([httpCrashInterceptor]))],
}).catch((err) => console.error(err));
