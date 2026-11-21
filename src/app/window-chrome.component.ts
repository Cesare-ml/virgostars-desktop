import {Component, ChangeDetectorRef, HostListener, Input, OnInit, inject} from '@angular/core';
import {getCurrentWindow, type ResizeDirection} from '@tauri-apps/api/window';

/**
 * Experimental Windows-only native chrome. The parent must only create this
 * component for a Windows Tauri WebView, never for a browser or macOS.
 */
@Component({
  selector: 'vs-window-chrome',
  standalone: true,
  templateUrl: './window-chrome.component.html',
  styleUrls: ['./window-chrome.component.css'],
})
export class WindowChromeComponent implements OnInit {
  @Input() locale = 'en';
  maximized = false;

  private readonly appWindow = getCurrentWindow();
  private readonly changeDetector = inject(ChangeDetectorRef);
  private checkingMaximized = false;

  ngOnInit(): void {
    void this.refreshMaximized();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    void this.refreshMaximized();
  }

  private async refreshMaximized(): Promise<void> {
    if (this.checkingMaximized) return;
    this.checkingMaximized = true;
    try {
      this.maximized = await this.appWindow.isMaximized();
      this.changeDetector.markForCheck();
    } catch {
      // A failed native query must not prevent the window controls from working.
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
