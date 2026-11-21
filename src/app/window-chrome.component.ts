import {CommonModule} from '@angular/common';
import {
  ChangeDetectorRef, Component, EventEmitter, HostBinding, HostListener,
  Input, NgZone, OnDestroy, OnInit, Output, inject,
} from '@angular/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {WindowChromeStateCoordinator} from './window-chrome-state';

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0];

/**
 * Windows-only experimental chrome. Browser and macOS retain native decorations.
 * Tauri event subscriptions are released on component destruction.
 */
@Component({
  selector: 'vs-window-chrome',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './window-chrome.component.html',
  styleUrls: ['./window-chrome.component.css'],
})
export class WindowChromeComponent implements OnInit, OnDestroy {
  @Input() locale = 'en';
  @Input() navCollapsed = false;
  @Input() contextTitle = '';
  @Output() readonly navigationToggle = new EventEmitter<void>();
  @Output() readonly displayScaleChanged = new EventEmitter<void>();
  @HostBinding('class.window-inactive') windowInactive = false;
  maximized = false;

  private readonly appWindow = getCurrentWindow();
  private readonly cd = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly maximizedState = new WindowChromeStateCoordinator(
    () => this.appWindow.isMaximized(),
    maximized => this.zone.run(() => {
      this.maximized = maximized;
      this.cd.markForCheck();
    }),
  );
  private readonly nativeUnlisteners: Array<() => void> = [];
  private destroyed = false;

  ngOnInit(): void {
    this.maximizedState.refresh();
    this.subscribeNativeWindowEvents();
  }

  /** DOM events remain a fallback if Tauri event subscriptions are unavailable. */
  @HostListener('window:resize')
  onWindowResize(): void {
    this.maximizedState.refresh();
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    if (this.destroyed) return;
    this.windowInactive = false;
    this.maximizedState.refresh();
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    if (!this.destroyed) this.windowInactive = true;
  }

  private subscribeNativeWindowEvents(): void {
    // Subscribe independently: a stalled native registration must never
    // prevent already-established listeners from being cleaned up.
    void this.trackNativeListener(
      this.appWindow.onResized(() => this.maximizedState.refresh()),
    );
    void this.trackNativeListener(
      this.appWindow.onFocusChanged(({payload: focused}) => {
        if (this.destroyed) return;
        this.zone.run(() => {
          this.windowInactive = !focused;
          this.cd.markForCheck();
        });
        if (focused) this.maximizedState.refresh();
      }),
    );
    void this.trackNativeListener(
      this.appWindow.onScaleChanged(() => {
        if (this.destroyed) return;
        this.maximizedState.refresh();
        // Browser CSS dimensions may remain unchanged at a new devicePixelRatio.
        // Tell the chart host to refresh its backing buffer for the new scale.
        this.zone.run(() => this.displayScaleChanged.emit());
      }),
    );
  }

  private async trackNativeListener(registration: Promise<() => void>): Promise<void> {
    try {
      const unlisten = await registration;
      if (this.destroyed) {
        // Registration can finish after component teardown.
        try { unlisten(); } catch { /* window may have closed */ }
      } else {
        this.nativeUnlisteners.push(unlisten);
      }
    } catch {
      // The DOM resize/focus handlers remain available as a fallback.
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.maximizedState.dispose();
    for (const unlisten of this.nativeUnlisteners.splice(0)) {
      try { unlisten(); } catch { /* native window may already have closed */ }
    }
  }

  minimize(): void {
    void this.appWindow.minimize().catch(() => this.maximizedState.refresh());
  }

  toggleMaximize(): void {
    void this.appWindow.toggleMaximize()
      .then(() => this.maximizedState.refresh())
      .catch(() => this.maximizedState.refresh());
  }

  close(): void {
    void this.appWindow.close().catch(() => this.maximizedState.refresh());
  }

  startResize(event: MouseEvent, direction: ResizeDirection): void {
    if (event.button !== 0 || this.maximized || this.destroyed) return;
    event.preventDefault();
    event.stopPropagation();
    void this.appWindow.startResizeDragging(direction).catch(() => undefined);
  }
}
