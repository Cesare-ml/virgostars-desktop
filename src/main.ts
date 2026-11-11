import { isDevMode, provideZonelessChangeDetection } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { DesktopAppComponent } from './app/desktop-app.component';
import { VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT } from './app/copilot-preview-token';
import { createNativeCopilotStagingTransport } from './app/native/copilot-staging-transport';

bootstrapApplication(DesktopAppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    {
      provide: VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT,
      useFactory: () => isDevMode() && isTauri()
        ? createNativeCopilotStagingTransport({
            isNative: isTauri,
            invoke: (command, args) => invoke<unknown>(command, args),
          })
        : null,
    },
  ],
})
  .catch(error => console.error('VirgoStars Desktop demo failed to start:', error instanceof Error ? error.message : 'unknown error'));
