import {CommonModule} from '@angular/common';
import {Component, ChangeDetectorRef, EventEmitter, HostBinding, HostListener, Input, OnDestroy, OnInit, Output, inject} from '@angular/core';
import {getCurrentWindow} from '@tauri-apps/api/window';

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0];

/**
 * Experimental Windows-only native chrome. The parent must only create this
 * component for a Windows Tauri WebView, never for a browser or macOS.
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
  @HostBinding('class.window-inactive') windowInactive = false;
  @Output() readonly navigationToggle = new EventEmitter<void>();
  maximized = false;

  private readonly appWindow = getCurrentWindow();
  private readonly changeDetector = inject(ChangeDetectorRef);
  private checkingMaximized = false;
  private refreshQueued = false;
  private destroyed = false;

  ngOnInit(): void {
    void this.refreshMaximized();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    void this.refreshMaximized();
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.windowInactive = false;
    void this.refreshMaximized();
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.windowInactive = true;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  private async refreshMaximized(): Promise<void> {
    if (this.destroyed) return;
    // Window resize and focus may arrive during an outstanding native query.
    // Read once more in that case, otherwise the restore icon can stay stale
    // after snapping or dragging between displays.
    if (this.checkingMaximized) {
      this.refreshQueued = true;
      return;
    }
    this.checkingMaximized = true;
    try {
      do {
        this.refreshQueued = false;
        try {
          const value = await this.appWindow.isMaximized();
          if (this.destroyed) return;
          this.maximized = value;
          this.changeDetector.markForCheck();
        } catch {
          // Keep existing controls available after a transient IPC failure.
        }
      } while (this.refreshQueued && !this.destroyed);
    } finally {
      this.checkingMaximized = false;
    }
  }

  minimize(): void {
    void this.appWindow.minimize().catch(() => this.refreshMaximized());
  }

  toggleMaximize(): void {
    void this.appWindow.toggleMaximize().then(() => this.refreshMaximized()).catch(() => this.refreshMaximized());
  }

  close(): void {
    void this.appWindow.close().catch(() => this.refreshMaximized());
  }

  startResize(event: MouseEvent, direction: ResizeDirection): void {
    if (event.button !== 0 || this.maximized) return;
    event.preventDefault();
    event.stopPropagation();
    void this.appWindow.startResizeDragging(direction).catch(() => undefined);
  }
}
