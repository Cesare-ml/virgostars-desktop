import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { DesktopAppComponent } from './app/desktop-app.component';

bootstrapApplication(DesktopAppComponent, { providers: [provideZonelessChangeDetection()] })
  .catch(error => console.error('VirgoStars Desktop demo failed to start:', error instanceof Error ? error.message : 'unknown error'));
