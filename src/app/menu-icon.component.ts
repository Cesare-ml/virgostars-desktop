import {CommonModule} from '@angular/common';
import {ChangeDetectionStrategy, Component, Input} from '@angular/core';

/** Reusable, stroke-only 24x24 iconography for the Desktop menus. */
export type MenuIconName = 'solar-return' | 'lunar-return' | 'account-virgostars' | 'monomeri';

@Component({
  selector: 'vs-menu-icon',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {'class': 'vs-menu-icon'},
  styles: [`
    :host { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; flex:0 0 22px; }
    svg { display:block; width:100%; height:100%; overflow:visible; }
  `],
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
      fill="none" stroke="currentColor" stroke-width="1.65"
      stroke-linecap="round" stroke-linejoin="round"
      [attr.data-menu-icon]="name" aria-hidden="true" focusable="false">
      <ng-container [ngSwitch]="name">
        <!-- A Sun and a return arrow; no RS typographic abbreviation. -->
        <g *ngSwitchCase="'solar-return'">
          <path d="M4.1 16.9A9 9 0 0 1 19.7 7.4"/>
          <path d="M16.1 7.3l3.8.3-.3-3.8"/>
          <circle cx="11.7" cy="12.2" r="3.1"/>
          <path d="M11.7 6.6V8M11.7 16.4v1.4M6.1 12.2h1.5M15.9 12.2h1.5
                   M7.9 8.4L9 9.5M14.4 14.9l1.1 1.1M15.5 8.4l-1.1 1.1M9 14.9l-1.1 1.1"/>
        </g>
        <!-- The same orbital return, with a crescent Moon replacing the Sun. -->
        <g *ngSwitchCase="'lunar-return'">
          <path d="M4.1 16.9A9 9 0 0 1 19.7 7.4"/>
          <path d="M16.1 7.3l3.8.3-.3-3.8"/>
          <path d="M14.8 7.9a5.7 5.7 0 1 0 1.2 8.2 5.4 5.4 0 0 1-1.2-8.2z"/>
        </g>
        <!-- Private user profile with a VirgoStars four-point celestial accent. -->
        <g *ngSwitchCase="'account-virgostars'">
          <circle cx="9.7" cy="8.5" r="3"/>
          <path d="M3.4 20.5v-1.9c0-3.1 2.9-5.1 6.3-5.1s6.3 2 6.3 5.1v1.9"/>
          <path d="M18.7 3l1.1 3.1 3 1.1-3 1.1-1.1 3.1-1.1-3.1-3-1.1 3-1.1z"/>
        </g>
        <!-- Stylised Egyptian Eye of Horus: a recognizable monomeri emblem. -->
        <g *ngSwitchCase="'monomeri'">
          <path d="M2.4 11.4c2.8-3.6 6-5.4 9.6-5.4s6.8 1.8 9.6 5.4c-2.8 3.7-6 5.5-9.6 5.5s-6.8-1.8-9.6-5.5z"/>
          <circle cx="12" cy="11.45" r="2.9"/>
          <path d="M5.2 6.5C9 4.1 15 3.9 19.2 6.5"/>
          <path d="M12 16.9c.2 1.8-1.5 3.7-4 4.3"/>
          <path d="M18.7 14.4l2.7 1.6"/>
        </g>
      </ng-container>
    </svg>
  `
})
export class MenuIconComponent {
  @Input({required: true}) name!: MenuIconName;
}
