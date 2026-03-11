import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { AskBoxComponent } from './components/ask-box.component';
import { ClassificationCheckComponent } from './components/classification-check.component';
import { ClarityScoreComponent } from './components/clarity-score.component';
import { CrawlSummaryComponent } from './components/crawl-summary.component';
import { SafetyScoreComponent } from './components/safety-score.component';
import { RedFlagsComponent } from './components/red-flags.component';
import { ScanInputComponent } from './components/scan-input.component';
import { ScanProgressComponent } from './components/scan-progress.component';
import { SchoolIdentityComponent } from './components/school-identity.component';
import { SchoolAdminComponent } from './components/school-admin.component';
import { AnalyticsPageComponent } from './components/analytics-page.component';

import { CompareService } from './services/compare.service';
import { CrashHandlerService } from './services/crash-handler.service';
import { ScanService } from './services/scan.service';
import { CompareApiError, CompareListSlot, CompareSlotNumber } from './models/compare.models';
import { SchoolIdentity, ScanResponse, ScanStatus, SSEEvent, RedFlagsResponse, RedFlag } from './models/scan.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ScanInputComponent,
    ScanProgressComponent,
    SchoolIdentityComponent,
    ClassificationCheckComponent,
    SafetyScoreComponent,
    RedFlagsComponent,
    ClarityScoreComponent,
    CrawlSummaryComponent,
    AskBoxComponent,
    SchoolAdminComponent,
    AnalyticsPageComponent,
  ],
  template: `
    <app-analytics-page *ngIf="isAnalyticsRoute"></app-analytics-page>
    <app-school-admin *ngIf="isSchoolAdminRoute"></app-school-admin>
    <div class="shell" *ngIf="!isSchoolAdminRoute && !isAnalyticsRoute">
      <!-- Header Nav: Home + Compare + Add School -->
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand" (click)="goHome()">SchoolLens</div>

          <nav class="nav">
            <button class="nav-btn" [class.active]="activeView === 'home'" (click)="goHome()">Home</button>
            <button class="nav-btn" [class.active]="activeView === 'compare'" (click)="goCompare()">
              Compare ({{ filledCount }}/3)
            </button>
            <a class="nav-btn" href="/schooladmin">School Admin</a>
            <a class="nav-btn" href="/analytics">Analytics</a>
            <button class="primary-btn" (click)="startAddToCompare()" [disabled]="!hasFreeSlot">
              Add school to compare
            </button>
          </nav>
        </div>
      </header>

      <!-- HOME (older homepage) -->
      <main *ngIf="activeView === 'home'">
        <app-scan-input
          [compact]="homeCompact"
          [schoolName]="homeIdentity?.name || ''"
          [board]="homeIdentity?.board || ''"
          [scanStatus]="homeScan?.status || 'Classifying'"
          (scanUrl)="startHomeScan($event)"
          (reset)="resetHome()">
        </app-scan-input>

        <div class="page" *ngIf="homeCompact">
          <div class="home-actions" *ngIf="homeScan?.url">
            <button class="ghost-btn" (click)="addCurrentHomeToCompare()" [disabled]="addingToCompareFromHome">
              {{ addingToCompareFromHome ? 'Adding…' : 'Add this school to compare' }}
            </button>
            <div class="guard" *ngIf="homeCompareMessage">{{ homeCompareMessage }}</div>
          </div>

          <app-scan-progress
            *ngIf="homeScan && !isTerminal(homeScan.status)"
            [status]="homeScan.status"
            [crawlSummary]="homeScan.crawlSummary || null"
            [pagesCrawled]="homeSse.pagesCrawled"
            [pagesDiscovered]="homeSse.pagesDiscovered"
            [factsExtracted]="homeSse.factsExtracted">
          </app-scan-progress>

          <app-classification-check
            *ngIf="homeScan?.status === 'Rejected' || homeScan?.status === 'Uncertain'"
            [status]="homeScan?.status === 'Uncertain' ? 'Uncertain' : 'Rejected'"
            [classification]="homeScan?.classification || null"
            (retry)="resetHome()">
          </app-classification-check>

          <div class="home-split-layout">
            <div class="home-left-column">

          <app-school-identity
            *ngIf="homeIdentity"
            [identity]="homeIdentity"
            [overallScore]="homeScan?.overallScore || 0">
          </app-school-identity>

          <div class="card" *ngIf="homeScan?.status === 'Ready' && homeScan?.summary">
            <div class="card-title">Summary</div>
            <div class="summary" [class.summary-clamped]="!summaryExpanded">{{ homeScan?.summary }}</div>
            <button class="read-more-btn" (click)="summaryExpanded = !summaryExpanded">
              {{ summaryExpanded ? 'Show less ▲' : 'Read more ▼' }}
            </button>
          </div>

          <div class="card five-points-card" *ngIf="homeScan?.status === 'Ready'">
            <div class="pill-btn-row">
              <button class="fivepoints-outline-btn" [disabled]="fivePointsLoading" (click)="toggleFivePoints()">
                <span class="pill-icon">✨</span>
                <span [style.opacity]="fivePointsLoading ? 0 : 1">{{ fivePointsOpen ? 'Highlights ▲' : 'Highlights' }}</span>
                <span class="five-dots" *ngIf="fivePointsLoading" aria-hidden="true"><span></span><span></span><span></span></span>
              </button>

              <button class="rf-outline-btn" [class.rf-is-loading]="rfLoading" [disabled]="rfLoading" (click)="toggleRedFlags()" [attr.aria-expanded]="rfOpen">
                <span class="rf-btn-inner" [style.opacity]="rfLoading ? 0 : 1">
                  <span class="pill-icon">&#x1F6A9;</span>
                  <span class="rf-count" *ngIf="rfLoaded && rfFlags.length">{{ rfFlags.length }}</span>
                  {{ rfOpen ? 'Red Flags ▲' : 'Red Flags' }}
                </span>
                <span class="five-dots" *ngIf="rfLoading" aria-hidden="true"><span></span><span></span><span></span></span>
              </button>
            </div>

            <!-- Red Flags inline panel -->
            <div class="inline-panel rf-inline-panel" [class.open]="rfOpen">
              <div class="inline-panel-inner">
                <ng-container *ngIf="rfLoading">
                  <div class="skel-row" *ngFor="let _ of [0,1,2]">
                    <div class="skel-badge"></div>
                    <div class="skel-lines"><div class="skel-line long"></div><div class="skel-line short"></div></div>
                  </div>
                </ng-container>
                <ng-container *ngIf="rfLoaded">
                  <div class="rf-flag-row" *ngFor="let f of rfFlags; let i = index"
                    [style.animation-delay]="(i * 80) + 'ms'"
                    [class.rf-high]="f.severity === 'high'"
                    [class.rf-medium]="f.severity === 'medium'">
                    <span class="rf-severity" [class.high]="f.severity==='high'" [class.medium]="f.severity==='medium'">
                      {{ f.severity === 'high' ? 'High' : 'Medium' }}
                    </span>
                    <div class="rf-text">
                      <div class="rf-flag-title">{{ f.flag }}</div>
                      <div class="rf-flag-reason">{{ f.reason }}</div>
                    </div>
                  </div>
                  <div class="rf-empty" *ngIf="rfFlags.length === 0">✅ No major red flags found based on publicly available information.</div>
                  <div class="inline-panel-footer">Based on crawled website data</div>
                </ng-container>
                <div class="rf-error" *ngIf="rfError">
                  ⚠️ Could not load red flags.
                  <button class="link-btn" (click)="toggleRedFlags()">Retry</button>
                </div>
              </div>
            </div>

            <!-- 5 Things to Know inline panel -->
            <div class="inline-panel fp-inline-panel" [class.open]="fivePointsOpen">
              <div class="inline-panel-inner">
                <div class="five-points-body">
                  <div class="five-point" *ngFor="let p of getFivePoints(homeScan)">
                    <span class="point-icon">{{ p.icon }}</span>
                    <div class="point-content">
                      <div class="point-text">{{ p.text }}</div>
                      <div class="point-source">Source: {{ p.source }}</div>
                    </div>
                  </div>
                  <div class="five-points-empty" *ngIf="getFivePoints(homeScan).length === 0">
                    No confirmed data points yet — try again once analysis is complete.
                  </div>
                </div>
              </div>
            </div>
          </div>

              <app-safety-score *ngIf="homeScan?.safetyScore" [score]="homeScan?.safetyScore || null" (askAi)="triggerAskAi($event)"></app-safety-score>
              <app-clarity-score
                *ngIf="homeScan?.clarityScore"
                [score]="homeScan?.clarityScore || null"
                [earlyIdentity]="homeScan?.earlyIdentity || null"
                [summary]="homeScan?.summary || null"
                (askAi)="triggerAskAi($event)"></app-clarity-score>
              <app-crawl-summary *ngIf="isAdmin && homeScan?.crawlSummary" [summary]="homeScan?.crawlSummary || null"></app-crawl-summary>

            </div><!-- /home-left-column -->
            <div class="home-right-column">
              <app-ask-box
                #homeAskBox
                *ngIf="homeScan"
                [sessionId]="homeScan.sessionId"
                [enabled]="homeScan.status === 'Ready'"
                [activeCategory]="'safety'">
              </app-ask-box>
            </div><!-- /home-right-column -->
          </div><!-- /home-split-layout -->
        </div>
      </main>

      <!-- Mobile ask FAB — visible only on small screens when scan is loaded -->
      <button class="mobile-ask-fab" *ngIf="homeCompact && homeScan" (click)="mobileAskOpen = true" aria-label="Ask about this school">&#x1F4AC;</button>

      <!-- Mobile ask bottom sheet: always in DOM, visibility controlled by class -->
      <div class="mobile-ask-overlay" [class.open]="mobileAskOpen" (click)="mobileAskOpen = false"></div>
      <div class="mobile-ask-sheet" [class.open]="mobileAskOpen">
        <div class="sheet-handle"></div>
        <app-ask-box
          *ngIf="homeScan"
          [sessionId]="homeScan.sessionId"
          [enabled]="homeScan?.status === 'Ready'"
          [activeCategory]="'safety'">
        </app-ask-box>
      </div>

      <!-- COMPARE (starts only when user clicks Compare/Add) -->
      <main class="page" *ngIf="activeView === 'compare'">
        <section class="card">
          <div class="card-title">Compare (3 slots)</div>

          <div class="guard" *ngIf="guardMessage">{{ guardMessage }}</div>
          <div class="stale-guard" *ngIf="stalePrompt">
            <div class="stale-text">Data from {{ stalePrompt.ageDays }} days ago — add anyway or refresh?</div>
            <div class="stale-actions">
              <button class="ghost-btn" (click)="resolveStale('add_anyway')">Add anyway</button>
              <button class="ghost-btn" (click)="resolveStale('refresh')">Refresh →</button>
            </div>
          </div>

          <div class="slots">
            <div class="slot" *ngFor="let s of slots">
              <ng-container *ngIf="s.item; else emptySlot">
                <div class="slot-top">
                  <div class="slot-name" [title]="getSlotDisplayName(s)">{{ getSlotDisplayName(s) }}</div>
                  <div class="badge" [class.stale]="s.item.freshness.isStale" *ngIf="s.item.completedAt">
                    {{ badgeText(s) }}
                  </div>
                </div>

                <div class="slot-url">{{ s.item.url }}</div>

                <div class="slot-status" *ngIf="isInProgress(s.item.status)">⏳ Analysis running, ready in ~30s</div>
                <div class="slot-status blocked" *ngIf="s.item.status === 'Rejected'">Blocked: Not an educational institution</div>
                <div class="slot-status blocked" *ngIf="s.item.status === 'Uncertain'">Needs review: School signals are partial</div>
                <div class="slot-status saved" *ngIf="s.item.status === 'Ready'">✓ Saved to Compare</div>

                <div class="slot-actions">
                  <button class="link-btn" (click)="refreshSlot(s.slot)">Refresh</button>
                  <button class="link-btn" (click)="remove(s.slot)">Remove</button>
                </div>
              </ng-container>

              <ng-template #emptySlot>
                <div class="empty" [class.active]="activeAddSlot === s.slot" (click)="activateEmptySlot(s.slot)">
                  <div class="empty-title">+ Add School</div>

                  <ng-container *ngIf="activeAddSlot === s.slot && showCompareUrlInput">
                    <div class="empty-form">
                      <input
                        class="search-input"
                        [(ngModel)]="newUrl"
                        placeholder="Paste a school website URL"
                        (keyup.enter)="addFromCompareSlot()" />
                      <button
                        class="primary-btn"
                        (click)="addFromCompareSlot()"
                        [disabled]="adding || !newUrl.trim()">
                        Add
                      </button>
                    </div>
                  </ng-container>
                </div>
              </ng-template>
            </div>
          </div>

          <div class="compare-ready">
            <div class="ready-text" *ngIf="filledCount === 0">Add schools to start comparing</div>
            <div class="ready-text" *ngIf="filledCount === 1">Add at least one more to compare</div>
            <button class="ghost-btn clear-all" *ngIf="filledCount >= 1" (click)="clearAll()" [disabled]="clearing">{{ clearing ? 'Clearing…' : 'Clear all' }}</button>
            <button class="primary-btn" *ngIf="filledCount >= 2"
              (click)="scrollToTable()"
              [disabled]="anySlotInProgress"
              [title]="anySlotInProgress ? 'Waiting for ' + comparingBlockedBy : ''">
              {{ anySlotInProgress ? 'Waiting for ' + comparingBlockedBy + '…' : 'Start Comparing →' }}
            </button>
          </div>
        </section>

        <section class="compare-layout" *ngIf="filledCount >= 2" id="compare-table">
          <div class="card table-card">
            <div class="card-title">Comparison Table</div>

            <nav class="quick-jump">
              <button class="qj-btn" (click)="scrollToSection('section-safety')">Safety</button>
              <button class="qj-btn" (click)="scrollToSection('section-academics')">Academics</button>
              <button class="qj-btn" (click)="scrollToSection('section-fees')">Fees</button>
              <button class="qj-btn" (click)="scrollToSection('section-admissions')">Admissions</button>
              <button class="qj-btn" (click)="scrollToSection('section-extracurricular')">Extra Curricular</button>
            </nav>

            <div class="table-wrap">
              <table class="compare-table">
                <thead>
                  <tr>
                    <th class="metric-col">Metric</th>
                    <th *ngFor="let s of filledSlots" [title]="getSlotDisplayName(s) + ' \u2014 ' + (s.item?.url || '')">
                      <div class="th-name">{{ truncateName(getSlotDisplayName(s)) }}</div>
                      <div class="th-badge" *ngIf="s.item?.completedAt" [class.stale]="s.item?.freshness.isStale">
                        {{ badgeText(s) }}
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr *ngFor="let m of enabledMetrics">
                    <td class="metric-col">{{ m.label }}</td>
                    <td *ngFor="let s of filledSlots">
                      <ng-container *ngIf="getScan(s.item?.sessionId) as scan; else noData">
                        <div class="cell" [ngClass]="getCellClasses(m.id, scan)">
                          <ng-container *ngIf="metricState(m.id, scan) === 'in_progress'; else showVal">
                            <div class="shimmer"></div>
                          </ng-container>
                          <ng-template #showVal>
                            <div class="cell-value">{{ metricValue(m.id, scan) }}</div>
                          </ng-template>
                        </div>
                      </ng-container>
                      <ng-template #noData>
                        <div class="cell loading">
                          <div class="shimmer"></div>
                        </div>
                      </ng-template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <aside class="card sidebar">
            <div class="card-title">Extended Metrics (max 10)</div>

            <div class="limit" *ngIf="metricLimitMessage">{{ metricLimitMessage }}</div>

            <div class="metric-group" *ngFor="let g of metricGroups; let i = index">
              <div class="group-title" (click)="toggleAccordion(i)">
                {{ g.label }}
                <span class="accordion-icon">{{ isAccordionOpen(i) ? '▲' : '▼' }}</span>
              </div>
              <div class="group-content" [class.collapsed]="!isAccordionOpen(i)">
                <label class="metric-row" *ngFor="let m of g.metrics">
                  <input
                    type="checkbox"
                    [checked]="isMetricEnabled(m.id)"
                    (change)="toggleMetric(m.id, $event.target.checked)" />
                  <span>{{ m.label }}</span>
                </label>
              </div>
            </div>
          </aside>
        </section>
      </main>

      <div class="crash-modal-overlay" *ngIf="crashModalOpen">
        <div class="crash-modal">
          <div class="crash-modal-title">{{ crashTitle }}</div>
          <div class="crash-modal-message">{{ crashMessage }}</div>
          <button class="primary-btn" (click)="closeCrashModal()">Back to Home</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: var(--sl-bg, #f8f9fa); min-height: 100vh; }

    .shell { min-height: 100vh; }

    .crash-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 1200;
      background: rgba(15, 23, 42, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .crash-modal {
      width: min(460px, 100%);
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.22);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .crash-modal-title {
      font-size: 20px;
      font-weight: 800;
      color: var(--sl-text, #212121);
    }
    .crash-modal-message {
      font-size: 14px;
      color: var(--sl-text-muted, #616161);
      line-height: 1.5;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 200;
      background: #fff;
      box-shadow: var(--sl-shadow);
    }
    .topbar-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand {
      font-size: 18px;
      font-weight: 800;
      color: var(--sl-text, #212121);
      cursor: pointer;
      user-select: none;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .nav-btn {
      background: none;
      border: 1px solid #e0e0e0;
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      color: var(--sl-text, #212121);
      font-family: 'Roboto', sans-serif;
    }
    .nav-btn.active {
      border-color: var(--sl-primary, #1a237e);
      color: var(--sl-primary, #1a237e);
      font-weight: 700;
    }

    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px 16px 48px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .home-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    /* 60:40 split layout for main content and Ask Box */
    .home-split-layout {
      display: flex;
      gap: 24px;
      margin-top: 16px;
    }
    .home-left-column {
      flex: 1;
      min-width: 0;
    }
    .home-right-column {
      width: 320px;
      flex-shrink: 0;
      position: sticky;
      top: 80px;
      align-self: flex-start;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .home-right-column app-ask-box {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    @media (max-width: 900px) {
      .home-split-layout { flex-direction: column; }
      .home-right-column { display: none; }
    }

    .search-input {
      flex: 1;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 12px 12px;
      font-size: 14px;
      outline: none;
      color: var(--sl-text, #212121);
      font-family: 'Roboto', sans-serif;
      min-width: 200px;
    }

    .primary-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: none;
      border-radius: 10px;
      background: var(--sl-primary, #1a237e);
      color: #fff;
      padding: 12px 14px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
      white-space: nowrap;
    }
    .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .guard {
      font-size: 13px;
      color: var(--sl-amber, #e65100);
    }

    .stale-guard {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #fff8e1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 13px;
      color: var(--sl-text, #212121);
    }
    .stale-actions { display: flex; gap: 10px; }

    .ghost-btn {
      background: none;
      border: 1px solid #e0e0e0;
      color: var(--sl-text, #212121);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 13px;
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
    }

    .card {
      background: #fff;
      border-radius: var(--sl-radius, 12px);
      box-shadow: var(--sl-shadow);
      padding: 18px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--sl-text, #212121);
      margin-bottom: 12px;
    }

    .summary { font-size: 14px; color: var(--sl-text, #212121); line-height: 1.6; }
    .summary-clamped {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .read-more-btn {
      background: none;
      border: none;
      padding: 6px 0 0;
      font-size: 13px;
      color: var(--sl-accent, #0d47a1);
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
      font-weight: 600;
    }
    .five-points-card { }
    .pill-btn-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .pill-icon { font-size: 15px; line-height: 1; }

    /* Outlined olive — Highlights */
    .fivepoints-outline-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 9px 18px;
      border: 1.5px solid #6b8f3a;
      border-radius: 999px;
      background: #fff;
      color: #4a6227;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
      transition: background 0.18s;
      white-space: nowrap;
    }
    .fivepoints-outline-btn:hover:not(:disabled) {
      background: #f4f9ed;
    }
    .fivepoints-outline-btn:disabled { cursor: not-allowed; opacity: 0.75; }

    /* Outlined red — Red Flags */
    .rf-outline-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 9px 18px;
      border: 1.5px solid #dc2626; border-radius: 999px;
      background: #fff; color: #c41a1a;
      font-size: 14px; font-weight: 600; cursor: pointer;
      font-family: 'Roboto', sans-serif;
      transition: background 0.18s, box-shadow 0.18s;
      white-space: nowrap; position: relative;
    }
    .rf-outline-btn:hover:not(:disabled) { background: #fff5f5; }
    .rf-outline-btn:disabled { cursor: not-allowed; opacity: 0.75; }
    /* Cycling border animation during loading — no overflow:hidden needed */
    .rf-outline-btn.rf-is-loading {
      border-color: transparent;
      animation: rf-cycle 1.2s linear infinite;
    }
    @keyframes rf-cycle {
      0%   { box-shadow: 0 0 0 1.5px #dc2626; }
      25%  { box-shadow: 0 0 0 1.5px #f97316; }
      50%  { box-shadow: 0 0 0 1.5px #fbbf24; }
      75%  { box-shadow: 0 0 0 1.5px #f97316; }
      100% { box-shadow: 0 0 0 1.5px #dc2626; }
    }
    .rf-btn-inner { display: flex; align-items: center; gap: 5px; transition: opacity 0.15s; }
    .rf-count {
      background: #ef4444; color: #fff; border-radius: 99px;
      font-size: 11px; font-weight: 700; min-width: 17px; height: 17px;
      display: inline-flex; align-items: center; justify-content: center; padding: 0 4px;
    }

    /* Shared spinner dots */
    .five-dots { display: flex; gap: 3px; align-items: center; position: absolute; }
    .five-dots span {
      width: 4px; height: 4px; border-radius: 50%; background: currentColor;
      animation: dotbounce 0.9s ease-in-out infinite;
    }
    .five-dots span:nth-child(1) { animation-delay: 0s; }
    .five-dots span:nth-child(2) { animation-delay: 0.18s; }
    .five-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes dotbounce { 0%,60%,100% { transform:translateY(0);opacity:.7 } 30% { transform:translateY(-4px);opacity:1 } }

    /* Collapsible inline panels */
    .inline-panel { max-height: 0; overflow: hidden; transition: max-height 0.25s cubic-bezier(0.4,0,0.2,1); }
    .inline-panel.open { max-height: 800px; }
    .inline-panel-inner { padding: 14px 0 4px; display: flex; flex-direction: column; gap: 10px; }

    /* RF panel tint */
    .rf-inline-panel.open .inline-panel-inner { background: #fff5f5; border-radius: 10px; padding: 14px; margin-top: 10px; }
    /* FP panel tint */
    .fp-inline-panel.open .inline-panel-inner { background: #f0fff4; border-radius: 10px; padding: 14px; margin-top: 10px; }

    /* RF flag rows */
    .rf-flag-row {
      display: flex; gap: 12px; align-items: flex-start;
      padding: 10px 12px; border-radius: 8px; background: #fff;
      border-left: 3px solid transparent;
      animation: flagin 0.32s ease both;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .rf-flag-row.rf-high   { border-left-color: #dc2626; }
    .rf-flag-row.rf-medium { border-left-color: #f59e0b; }
    @keyframes flagin { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:none } }
    .rf-severity {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
      padding: 3px 8px; border-radius: 6px; white-space: nowrap; flex-shrink: 0; margin-top: 2px;
    }
    .rf-severity.high   { background: #fee2e2; color: #991b1b; }
    .rf-severity.medium { background: #fef3c7; color: #92400e; }
    .rf-text { flex: 1; }
    .rf-flag-title { font-size: 13px; font-weight: 600; color: #212121; line-height: 1.4; }
    .rf-flag-reason { font-size: 12px; color: #616161; margin-top: 3px; line-height: 1.5; }
    .rf-empty { font-size: 13px; color: #2e7d32; display: flex; gap: 6px; }
    .rf-error { font-size: 13px; color: #9ca3af; }
    .inline-panel-footer { font-size: 11px; color: #9e9e9e; padding-top: 4px; }

    /* Skeleton rows (shared) */
    .skel-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; background: #fafafa; }
    .skel-badge { width: 50px; height: 20px; border-radius: 6px; background: linear-gradient(90deg,#e0e0e0 25%,#eeeeee 50%,#e0e0e0 75%); background-size:200% 100%; animation:skelsh 1.4s infinite; flex-shrink:0; }
    .skel-lines { flex:1; display:flex; flex-direction:column; gap:7px; padding-top:2px; }
    .skel-line { height:11px; border-radius:4px; background:linear-gradient(90deg,#e0e0e0 25%,#eeeeee 50%,#e0e0e0 75%); background-size:200% 100%; animation:skelsh 1.4s infinite; }
    .skel-line.long { width:80%; } .skel-line.short { width:55%; animation-delay:0.15s; }
    @keyframes skelsh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    /* Mobile Ask FAB — hidden on desktop */
    .mobile-ask-fab {
      display: none;
      position: fixed; bottom: 24px; right: 20px; z-index: 300;
      width: 52px; height: 52px; border-radius: 50%;
      background: var(--sl-primary, #1a237e); color: #fff;
      border: none; font-size: 22px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      align-items: center; justify-content: center;
    }
    @media (max-width: 900px) { .mobile-ask-fab { display: inline-flex; } }

    /* Mobile Ask overlay: always in DOM, uses opacity for transition */
    .mobile-ask-overlay {
      position: fixed; inset: 0; z-index: 350;
      background: rgba(0,0,0,0.32);
      opacity: 0; pointer-events: none;
      transition: opacity 0.28s;
    }
    .mobile-ask-overlay.open { opacity: 1; pointer-events: auto; }

    /* Mobile Ask bottom sheet */
    .mobile-ask-sheet {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 360;
      background: #fff; border-radius: 20px 20px 0 0;
      max-height: 88vh; overflow-y: auto;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      padding: 0 16px 32px;
    }
    .mobile-ask-sheet.open { transform: translateY(0); }
    .mobile-ask-sheet .sheet-handle {
      width: 40px; height: 4px; border-radius: 2px; background: #e0e0e0;
      margin: 14px auto 16px;
    }
    /* Hide overlay and sheet entirely on desktop */
    @media (min-width: 901px) {
      .mobile-ask-overlay, .mobile-ask-sheet { display: none !important; }
    }

    .five-toggle-btn { font-size: 12px; padding: 6px 10px; }
    .five-points-body { display: flex; flex-direction: column; gap: 12px; }
    .five-point {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .point-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .point-content { flex: 1; }
    .point-text { font-size: 14px; color: var(--sl-text, #212121); line-height: 1.5; font-weight: 500; }
    .point-source { font-size: 11px; color: var(--sl-text-muted, #616161); margin-top: 2px; }
    .five-points-empty { font-size: 13px; color: var(--sl-text-muted, #616161); margin-top: 8px; }

    .slots {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @media (min-width: 900px) {
      .slots { grid-template-columns: repeat(3, 1fr); }
    }

    .slot {
      border: 1px solid #eeeeee;
      border-radius: 12px;
      padding: 14px;
      min-height: 110px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
    }

    .slot-top { display: flex; justify-content: space-between; gap: 10px; }
    .slot-name {
      font-weight: 700;
      font-size: 14px;
      color: var(--sl-text, #212121);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }
    .slot-url { font-size: 12px; color: var(--sl-text-muted, #616161); word-break: break-all; }

    .badge {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 999px;
      background: #e8f5e9;
      color: #2e7d32;
      white-space: nowrap;
    }
    .badge.stale {
      background: #fff3e0;
      color: var(--sl-amber, #e65100);
    }

    .slot-status { font-size: 13px; color: var(--sl-text-muted, #616161); }
    .slot-status.saved { color: #2e7d32; font-weight: 600; }
    .slot-status.blocked { color: var(--sl-amber, #e65100); font-weight: 600; }

    .slot-actions { display: flex; gap: 10px; }
    .link-btn {
      background: none;
      border: none;
      padding: 0;
      font-size: 13px;
      color: var(--sl-accent, #0d47a1);
      cursor: pointer;
      text-decoration: underline;
      font-family: 'Roboto', sans-serif;
    }

    .empty { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .empty-title { font-weight: 700; color: var(--sl-text, #212121); }
    .empty-sub { font-size: 12px; color: var(--sl-text-muted, #616161); }
    .empty.active { border-left: 3px solid var(--sl-primary, #1a237e); padding-left: 10px; }

    .empty-form {
      margin-top: 10px;
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .compare-ready { margin-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .ready-text { font-size: 13px; color: var(--sl-text-muted, #616161); }

    .compare-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 1000px) {
      .compare-layout { grid-template-columns: 1fr 320px; }
    }

    .quick-jump {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .qj-btn {
      background: #f5f5f5;
      border: 1px solid #e0e0e0;
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: var(--sl-text, #212121);
      font-family: 'Roboto', sans-serif;
      transition: background 0.2s;
    }
    .qj-btn:hover { background: #e0e0e0; }

    .table-wrap { overflow-x: auto; }
    .compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .compare-table th, .compare-table td {
      border-bottom: 1px solid #eeeeee;
      padding: 10px 10px;
      vertical-align: top;
      min-width: 220px;
    }
    .metric-col { min-width: 160px !important; font-weight: 700; color: var(--sl-text, #212121); }
    .th-name { font-weight: 700; color: var(--sl-text, #212121); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .th-badge { margin-top: 4px; display: inline-block; }
    .th-badge.stale { color: var(--sl-amber, #e65100); }

    .cell { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
    .cell-value { color: var(--sl-text, #212121); font-size: 13px; line-height: 1.4; }
    .cell.cell-found .cell-value { color: var(--sl-text, #212121); font-weight: 500; }
    .cell.cell-missing .cell-value { color: var(--sl-amber, #e65100); font-weight: 700; }
    .cell.cell-progress { background: #f5f5f5; border-radius: 6px; min-height: 36px; position: relative; overflow: hidden; }
    .cell.cell-progress .cell-value { color: #9e9e9e; }

    /* Transparency score color coding */
    .cell.score-red .cell-value { color: #d32f2f; font-weight: 700; }
    .cell.score-orange .cell-value { color: var(--sl-amber, #e65100); font-weight: 700; }
    .cell.score-green .cell-value { color: #2e7d32; font-weight: 700; }

    .cell.loading { min-height: 40px; position: relative; }
    .shimmer {
      width: 100%;
      height: 16px;
      border-radius: 4px;
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .state {
      display: inline-block;
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 999px;
      width: fit-content;
      border: 1px solid #eeeeee;
      color: var(--sl-text-muted, #616161);
      background: #fafafa;
    }
    .state.disclosed { background: #e8f5e9; color: #2e7d32; border-color: #c8e6c9; }
    .state.not_disclosed { background: #f5f5f5; color: #616161; }
    .state.not_found { background: #fff3e0; color: var(--sl-amber, #e65100); border-color: #ffe0b2; }
    .state.unreadable { background: #fff3e0; color: var(--sl-amber, #e65100); border-color: #ffe0b2; }
    .state.in_progress { background: #f5f5f5; color: #616161; }

    .sidebar { height: fit-content; }
    .limit { font-size: 12px; color: var(--sl-amber, #e65100); margin-bottom: 10px; }
    .metric-group { margin-bottom: 12px; }
    .group-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--sl-text, #212121);
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .accordion-icon { font-size: 10px; color: var(--sl-text-muted, #616161); }
    .group-content { transition: max-height 0.2s ease-out; overflow: hidden; }
    .group-content.collapsed { max-height: 0; }
    @media (min-width: 1000px) {
      .group-content.collapsed { max-height: none; }
    }
    .metric-row { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--sl-text, #212121); margin: 6px 0; }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly compareService = inject(CompareService);
  private readonly crashHandler = inject(CrashHandlerService);
  private readonly scanService = inject(ScanService);

  @ViewChild('homeAskBox') homeAskBox?: AskBoxComponent;

  activeView: 'home' | 'compare' = 'home';
  readonly isSchoolAdminRoute = typeof window !== 'undefined'
    && window.location.pathname.toLowerCase().startsWith('/schooladmin');
  readonly isAnalyticsRoute = typeof window !== 'undefined'
    && window.location.pathname.toLowerCase().startsWith('/analytics');

  compareListId = '';

  // Compare add flow: only show URL input after user clicks "Add school"
  activeAddSlot: CompareSlotNumber | null = null;
  showCompareUrlInput = false;
  newUrl = '';
  adding = false;
  clearing = false;
  guardMessage = '';

  stalePrompt: { url: string; ageDays: number } | null = null;

  // Home scan flow (older homepage)
  homeCompact = false;
  mobileAskOpen = false;
  homeScan: ScanResponse | null = null;
  homeIdentity: SchoolIdentity | null = null;
  homeCompareMessage = '';
  addingToCompareFromHome = false;
  homeSse = { pagesCrawled: 0, pagesDiscovered: 0, factsExtracted: 0 };

  // Admin mode: show crawl summary when ?admin=1 in URL
  isAdmin = false;

  summaryExpanded = false;
  fivePointsOpen = false;
  fivePointsLoading = false;
  rfOpen = false;
  rfLoading = false;
  rfLoaded = false;
  rfError = false;
  rfFlags: RedFlag[] = [];
  rfCachedSessionId = '';

  private homePollSub: Subscription | null = null;
  private homeSseSub: Subscription | null = null;
  private crashSub: Subscription | null = null;

  crashModalOpen = false;
  crashTitle = 'We are repairing it';
  crashMessage = 'Something broke unexpectedly. Please return to Home while we fix it.';

  private readonly onWindowError = () => {
    this.crashHandler.report('Something broke unexpectedly. Please return to Home while we fix it.');
  };

  private readonly onUnhandledRejection = () => {
    this.crashHandler.report('Something broke unexpectedly. Please return to Home while we fix it.');
  };

  slots: CompareListSlot[] = [
    { slot: 1, item: null },
    { slot: 2, item: null },
    { slot: 3, item: null },
  ];

  private pollingTimer: number | null = null;
  private scansBySessionId: Record<string, ScanResponse> = {};

  // Metrics
  metricLimitMessage = '';
  private enabledMetricIds = new Set<string>(['transparency_score', 'location', 'board', 'year_of_starting', 'safety', 'fees', 'people_ratio']);

  // Mobile accordion state (open all by default on desktop, closed on mobile)
  private openAccordionIds = new Set<number>();

  readonly metricGroups: Array<{ label: string; metrics: Array<{ id: string; label: string }> }> = [
    {
      label: '📊 Overview',
      metrics: [
        { id: 'transparency_score', label: 'Transparency Score' },
        { id: 'location', label: 'Location' },
      ],
    },
    {
      label: '🏫 Basics',
      metrics: [
        { id: 'board', label: 'Board (CBSE/IB/State)' },
        { id: 'year_of_starting', label: 'Year of Starting' },
      ],
    },
    {
      label: '💰 Fees Group',
      metrics: [
        { id: 'fees', label: 'Fees' },
        { id: 'fees_admission_breakdown', label: 'Admission fee breakdown' },
        { id: 'fees_transport', label: 'Transport fee (if mentioned)' },
        { id: 'fees_source_confidence', label: 'Fee source confidence (PDF/HTML/Estimated)' },
      ],
    },
    {
      label: '🛡️ Safety Group',
      metrics: [
        { id: 'safety', label: 'Safety' },
        { id: 'safety_fire_noc', label: 'Fire NOC document found' },
        { id: 'safety_sanitary', label: 'Sanitary certificate mentioned' },
        { id: 'safety_guards', label: 'Security guards mentioned' },
      ],
    },
    {
      label: '📚 Academics Group',
      metrics: [
        { id: 'academics_subjects', label: 'Subjects offered (beyond standard)' },
        { id: 'academics_coaching', label: 'Extra coaching/test prep mentioned' },
      ],
    },
    {
      label: '🏛️ Infrastructure Group',
      metrics: [
        { id: 'infra_science_lab', label: 'Science lab quality' },
        { id: 'infra_computer_lab', label: 'Computer lab status' },
        { id: 'infra_playground', label: 'Playground/sports ground' },
        { id: 'infra_library', label: 'Library facilities' },
        { id: 'infra_auditorium', label: 'Auditorium/multipurpose hall' },
      ],
    },
    {
      label: '👥 People Group',
      metrics: [
        { id: 'people_principal', label: 'Principal name found' },
        { id: 'people_ratio', label: 'Student-Teacher ratio (PDF disclosure)' },
      ],
    },
    {
      label: '📅 Admissions Group',
      metrics: [
        { id: 'admissions_status', label: 'Currently open/closed status' },
        { id: 'admissions_deadline', label: 'Admission deadline (countdown)' },
        { id: 'admissions_open_seats', label: 'Classes with open seats' },
      ],
    },
    {
      label: '📋 Trust Group',
      metrics: [
        { id: 'trust_availability', label: 'Information availability score' },
        { id: 'trust_readability', label: 'Document readability (HTML vs PDF)' },
      ],
    },
  ];

  get enabledMetrics(): Array<{ id: string; label: string }> {
    const all = this.metricGroups.flatMap((g) => g.metrics);
    return all.filter((m) => this.enabledMetricIds.has(m.id));
  }

  get filledSlots(): CompareListSlot[] {
    return this.slots.filter((s) => Boolean(s.item));
  }

  get filledCount(): number {
    return this.filledSlots.length;
  }

  get hasFreeSlot(): boolean {
    return this.slots.some((s) => !s.item);
  }

  ngOnInit() {
    // Check if admin mode is enabled via URL query parameter
    const urlParams = new URLSearchParams(window.location.search);
    this.isAdmin = urlParams.get('admin') === '1';

    const existing = this.compareService.getStoredCompareListId();
    if (existing) {
      this.compareListId = existing;
      this.loadCompareList({ createIfMissing: true });
    } else {
      this.createCompareList();
    }

    // On desktop, open all accordion panels; on mobile, keep closed
    if (window.innerWidth >= 1000) {
      this.metricGroups.forEach((_, i) => this.openAccordionIds.add(i));
    }

    this.crashSub?.unsubscribe();
    this.crashSub = this.crashHandler.crash$.subscribe((ev) => {
      this.crashTitle = ev.title;
      this.crashMessage = ev.message;
      this.crashModalOpen = true;
      this.goHome();
    });

    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  toggleAccordion(index: number) {
    if (this.openAccordionIds.has(index)) {
      this.openAccordionIds.delete(index);
    } else {
      this.openAccordionIds.add(index);
    }
  }

  isAccordionOpen(index: number): boolean {
    return this.openAccordionIds.has(index);
  }

  ngOnDestroy() {
    if (this.pollingTimer !== null) {
      window.clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.homePollSub?.unsubscribe();
    this.homePollSub = null;
    this.homeSseSub?.unsubscribe();
    this.homeSseSub = null;
    this.crashSub?.unsubscribe();
    this.crashSub = null;
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  closeCrashModal() {
    this.crashModalOpen = false;
    this.crashHandler.clear();
    this.goHome();
  }

  goHome() {
    this.activeView = 'home';
  }

  goCompare() {
    this.activeView = 'compare';
    if (!this.activeAddSlot) this.activeAddSlot = (this.slots.find((s) => !s.item)?.slot ?? null) as CompareSlotNumber | null;
  }

  startAddToCompare() {
    this.goCompare();
    const firstEmpty = (this.slots.find((s) => !s.item)?.slot ?? null) as CompareSlotNumber | null;
    if (!firstEmpty) return;
    this.activeAddSlot = firstEmpty;
    this.showCompareUrlInput = true;
    this.guardMessage = '';
    this.stalePrompt = null;
  }

  activateEmptySlot(slot: CompareSlotNumber) {
    if (this.slots.find((s) => s.slot === slot)?.item) return;
    this.activeAddSlot = slot;
    this.showCompareUrlInput = true;
    this.guardMessage = '';
    this.stalePrompt = null;
  }

  startHomeScan(url: string) {
    this.resetHome();
    this.homeCompact = true;

    this.scanService.submitScan(url).subscribe({
      next: (res) => {
        this.homeScan = res;
        this.homeIdentity = this.toSchoolIdentity(res);
        this.startHomeSse(res.sessionId);
        this.startHomePolling(res.sessionId);
      },
      error: () => {
        // Let ScanInput keep its own inline validation; here we just reset back
        this.homeCompact = false;
        this.homeScan = null;
        this.homeIdentity = null;
      },
    });
  }

  private startHomePolling(sessionId: string) {
    this.homePollSub?.unsubscribe();
    this.homePollSub = this.scanService.pollUntilDone(sessionId).subscribe({
      next: (res) => {
        this.homeScan = res;
        this.homeIdentity = this.toSchoolIdentity(res);
      },
      error: () => {
        // ignore transient
      },
    });
  }

  private startHomeSse(sessionId: string) {
    this.homeSseSub?.unsubscribe();
    this.homeSseSub = this.scanService.connectSSE(sessionId).subscribe({
      next: (ev: SSEEvent) => this.applyHomeSse(ev),
      error: () => {
        // ignore
      },
    });
  }

  private applyHomeSse(ev: SSEEvent) {
    if (ev.type === 'page_crawled') {
      const n = Number((ev.data as any).pagesCrawled ?? 0);
      if (n > this.homeSse.pagesCrawled) this.homeSse.pagesCrawled = n;
    }
    if (ev.type === 'discovery_complete') {
      const n = Number((ev.data as any).pagesDiscovered ?? 0);
      if (n > this.homeSse.pagesDiscovered) this.homeSse.pagesDiscovered = n;
    }
    if (ev.type === 'crawl_complete') {
      const n = Number((ev.data as any).factsExtracted ?? 0);
      if (n > this.homeSse.factsExtracted) this.homeSse.factsExtracted = n;
    }
    if (ev.type === 'identity' && this.homeScan) {
      this.homeScan = { ...this.homeScan, earlyIdentity: ev.data as any };
      this.homeIdentity = this.toSchoolIdentity(this.homeScan);
    }
  }

  resetHome() {
    this.homePollSub?.unsubscribe();
    this.homePollSub = null;
    this.homeSseSub?.unsubscribe();
    this.homeSseSub = null;

    this.homeCompact = false;
    this.homeScan = null;
    this.homeIdentity = null;
    this.homeCompareMessage = '';
    this.addingToCompareFromHome = false;
    this.homeSse = { pagesCrawled: 0, pagesDiscovered: 0, factsExtracted: 0 };
    this.rfOpen = false; this.rfLoading = false; this.rfLoaded = false; this.rfError = false; this.rfFlags = []; this.rfCachedSessionId = '';
    this.fivePointsOpen = false; this.fivePointsLoading = false;
    this.mobileAskOpen = false;
  }

  addCurrentHomeToCompare() {
    if (!this.homeScan?.url || this.addingToCompareFromHome) return;
    this.homeCompareMessage = '';
    this.addingToCompareFromHome = true;

    this.compareService.addSchool(this.compareListId, this.homeScan.url).subscribe({
      next: () => {
        this.addingToCompareFromHome = false;
        this.goCompare();
        this.loadCompareList({ createIfMissing: false });
      },
      error: (err) => {
        this.addingToCompareFromHome = false;
        const apiErr = (err?.error ?? null) as CompareApiError | null;
        this.homeCompareMessage = apiErr?.message || 'Could not add to compare. Please try again.';
      },
    });
  }

  private toSchoolIdentity(scan: ScanResponse): SchoolIdentity {
    const early = (scan.earlyIdentity || {}) as any;
    const rawName = (early.schoolName && String(early.schoolName).trim()) ? String(early.schoolName).trim() : this.safeHostnameLabel(scan.url);
    const name = this.cleanSchoolName(rawName);
    const board = this.inferBoard(scan);
    return {
      name,
      board,
      websiteUrl: scan.url,
      phone: early.phone ? String(early.phone) : null,
      phones: Array.isArray(early.phones) ? early.phones.map((p: unknown) => String(p)).filter((p: string) => p.trim().length > 0).slice(0, 3) : null,
      email: early.email ? String(early.email) : null,
      address: early.address ? String(early.address) : null,
      principal: early.principalName ? String(early.principalName) : 'Not Able to Identify - Missing Data.',
      foundingYear: early.foundingYear ? String(early.foundingYear) : null,
      vision: early.vision ? String(early.vision) : null,
      mission: early.mission ? String(early.mission) : null,
      motto: early.motto ? String(early.motto) : null,
      facilities: Array.isArray(early.facilities) ? early.facilities.map((f: unknown) => String(f)).slice(0, 8) : null,
      socialUrls: early.socialUrls ? early.socialUrls : null,
    };
  }

  private createCompareList() {
    this.compareService.createCompareList().subscribe({
      next: (res) => {
        this.compareListId = res.compareListId;
        this.compareService.setStoredCompareListId(this.compareListId);
        this.loadCompareList({ createIfMissing: false });
      },
      error: () => {
        this.guardMessage = 'Could not start compare list. Please try again.';
      },
    });
  }

  private loadCompareList(opts: { createIfMissing: boolean }) {
    this.compareService.getCompareList(this.compareListId).subscribe({
      next: (res) => {
        this.slots = res.slots;
        this.guardMessage = '';
        this.loadAllScans();
        this.ensurePolling();
      },
      error: (err) => {
        if (opts.createIfMissing && err?.status === 404) {
          this.compareService.clearStoredCompareListId();
          this.compareListId = '';
          this.createCompareList();
          return;
        }
        this.guardMessage = 'Could not load compare list.';
      },
    });
  }

  private ensurePolling() {
    if (this.pollingTimer !== null) return;
    this.pollingTimer = window.setInterval(() => {
      for (const slot of this.slots) {
        const sessionId = slot.item?.sessionId;
        const status = slot.item?.status;
        if (!sessionId || !status) continue;
        if (this.isTerminal(status)) continue;
        this.scanService.getStatus(sessionId).subscribe({
          next: (res) => {
            this.scansBySessionId[sessionId] = res;
            this.mergeSlotFromScan(sessionId, res);
          },
          error: () => {
            // ignore transient
          },
        });
      }
    }, 2000);
  }

  private loadAllScans() {
    for (const slot of this.slots) {
      const sessionId = slot.item?.sessionId;
      if (!sessionId) continue;
      this.scanService.getStatus(sessionId).subscribe({
        next: (res) => {
          this.scansBySessionId[sessionId] = res;
          this.mergeSlotFromScan(sessionId, res);
        },
        error: () => {
          // ignore
        },
      });
    }
  }

  private mergeSlotFromScan(sessionId: string, scan: ScanResponse) {
    const slot = this.slots.find((s) => s.item?.sessionId === sessionId);
    if (!slot?.item) return;

    slot.item.status = scan.status;
    slot.item.url = scan.url || slot.item.url;
    slot.item.completedAt = scan.completedAt || slot.item.completedAt;
    slot.item.createdAt = scan.createdAt || slot.item.createdAt;

    const name = scan.earlyIdentity?.schoolName;
    if (name && name.trim()) slot.item.schoolName = name.trim();

    // Freshness from completedAt
    if (slot.item.completedAt) {
      const ageDays = this.ageDays(slot.item.completedAt);
      slot.item.freshness = { isStale: ageDays > 7, ageDays };
    }
  }

  addFromCompareSlot() {
    this.guardMessage = '';
    this.metricLimitMessage = '';
    const url = this.newUrl.trim();
    if (!url || !this.hasFreeSlot || this.adding) return;

    this.adding = true;
    this.stalePrompt = null;

    this.compareService.addSchool(this.compareListId, url).subscribe({
      next: () => {
        this.adding = false;
        this.newUrl = '';
        this.showCompareUrlInput = false;
        this.loadCompareList({ createIfMissing: false });
      },
      error: (err) => {
        this.adding = false;
        const apiErr = (err?.error ?? null) as CompareApiError | null;
        if (!apiErr?.code) {
          this.guardMessage = 'Could not add school. Please try again.';
          return;
        }

        if (apiErr.code === 'DUPLICATE') {
          this.guardMessage = 'Duplicate: This school is already in your list.';
          return;
        }
        if (apiErr.code === 'SLOT_FULL') {
          this.guardMessage = 'Slot full: Remove a school to add a new one.';
          return;
        }
        if (apiErr.code === 'IN_PROGRESS') {
          this.guardMessage = 'In-progress: Analysis running, ready in ~30s.';
          return;
        }
        if (apiErr.code === 'STALE') {
          this.stalePrompt = { url, ageDays: apiErr.ageDays ?? 8 };
          return;
        }
        this.guardMessage = apiErr.message || 'Could not add school.';
      },
    });
  }

  resolveStale(action: 'add_anyway' | 'refresh') {
    if (!this.stalePrompt) return;
    const url = this.stalePrompt.url;
    this.stalePrompt = null;
    this.adding = true;
    this.compareService.addSchool(this.compareListId, url, action).subscribe({
      next: () => {
        this.adding = false;
        this.newUrl = '';
        this.showCompareUrlInput = false;
        this.loadCompareList({ createIfMissing: false });
      },
      error: () => {
        this.adding = false;
        this.guardMessage = 'Could not apply stale action. Please try again.';
      },
    });
  }

  remove(slot: CompareSlotNumber) {
    this.compareService.removeSlot(this.compareListId, slot).subscribe({
      next: () => this.loadCompareList({ createIfMissing: false }),
      error: () => { this.guardMessage = 'Could not remove slot.'; },
    });
  }

  clearAll() {
    if (this.clearing || this.filledCount === 0) return;
    this.clearing = true;
    this.guardMessage = '';
    this.compareService.clearAll(this.compareListId).subscribe({
      next: () => {
        this.clearing = false;
        this.loadCompareList({ createIfMissing: false });
      },
      error: () => {
        this.clearing = false;
        this.guardMessage = 'Could not clear slots.';
      },
    });
  }

  refreshSlot(slot: CompareSlotNumber) {
    const sessionId = this.slots.find((s) => s.slot === slot)?.item?.sessionId;
    if (!sessionId) return;
    this.compareService.refreshSession(sessionId).subscribe({
      next: () => this.loadCompareList({ createIfMissing: false }),
      error: (err) => {
        const apiErr = (err?.error ?? null) as CompareApiError | null;
        this.guardMessage = apiErr?.message || 'Could not refresh.';
      },
    });
  }

  isActiveEmptySlot(slot: CompareSlotNumber): boolean {
    const firstEmpty = this.slots.find((s) => !s.item)?.slot ?? null;
    return firstEmpty === slot;
  }

  badgeText(s: CompareListSlot): string {
    const item = s.item;
    if (!item?.completedAt) return '';
    if (item.freshness.isStale) return `Stale — ${item.freshness.ageDays} days ago ⚠️`;
    const hours = this.ageHours(item.completedAt);
    if (hours < 24) return `Fresh — ${hours}h ago`;
    return `Fresh — ${item.freshness.ageDays} days ago`;
  }

  private ageDays(isoOrDate: string): number {
    const t = new Date(isoOrDate).getTime();
    const ms = Date.now() - t;
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  private ageHours(isoOrDate: string): number {
    const t = new Date(isoOrDate).getTime();
    const ms = Date.now() - t;
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60)));
  }

  isTerminal(status: string): boolean {
    return status === 'Ready' || status === 'Rejected' || status === 'Uncertain' || status === 'Failed' || status === 'Error';
  }

  private safeHostnameLabel(url: string | undefined | null): string {
    if (!url) return 'Unknown';
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./i, '') || url;
    } catch {
      return url;
    }
  }

  isInProgress(status: string): boolean {
    return status === 'Classifying' || status === 'Crawling' || status === 'Scoring';
  }

  getScan(sessionId: string | undefined): ScanResponse | null {
    if (!sessionId) return null;
    return this.scansBySessionId[sessionId] ?? null;
  }

  isMetricEnabled(id: string): boolean {
    return this.enabledMetricIds.has(id);
  }

  toggleMetric(id: string, enabled: boolean) {
    this.metricLimitMessage = '';
    if (enabled) {
      if (this.enabledMetricIds.size >= 10) {
        this.metricLimitMessage = 'Max 10 metrics selected.';
        return;
      }
      this.enabledMetricIds.add(id);
    } else {
      this.enabledMetricIds.delete(id);
    }
  }

  metricValue(metricId: string, scan: ScanResponse): string {
    if (!scan || !this.isTerminal(scan.status)) return 'In progress';

    // Default 5 metrics (hybrid: values derived from existing safety/clarity)
    if (metricId === 'transparency_score') {
      const score = scan.overallScore ?? 0;
      return score > 0 ? `${score}%` : 'Not clearly mentioned';
    }
    if (metricId === 'location') {
      return scan.earlyIdentity?.address ?? 'Not clearly mentioned';
    }
    if (metricId === 'fees') {
      return scan.clarityScore?.items.feeClarity ? 'Full schedule found' : 'Not clearly mentioned';
    }
    if (metricId === 'safety') {
      const safety = scan.safetyScore;
      if (!safety) return 'In progress';
      const bits: string[] = [];
      if (safety.items.cctvMention.status === 'found') bits.push('CCTV');
      if (safety.items.transportSafety.status === 'found') bits.push('Transport safety');
      if (safety.items.fireCertificate.status === 'found') bits.push('Fire certificate');
      if (safety.items.sanitaryCertificate.status === 'found') bits.push('Sanitary certificate');
      if (safety.items.antiBullyingPolicy.status === 'found') bits.push('Anti-bullying');
      return bits.length ? bits.join(' + ') : 'Not clearly mentioned';
    }
    if (metricId === 'board') {
      const board = this.inferBoard(scan);
      return board ?? 'Not clearly mentioned';
    }
    if (metricId === 'results') {
      return scan.clarityScore?.items.resultsPublished ? 'Published' : 'Not clearly mentioned';
    }
    if (metricId === 'policy') {
      return scan.safetyScore?.items.antiBullyingPolicy.status === 'found' ? 'Anti-bullying policy found' : 'Not clearly mentioned';
    }

    // Extended metrics
    if (metricId === 'people_principal') {
      return scan.earlyIdentity?.principalName ? scan.earlyIdentity.principalName : 'Not clearly mentioned';
    }
    if (metricId === 'year_of_starting') {
      return scan.earlyIdentity?.foundingYear ? scan.earlyIdentity.foundingYear : 'Not clearly mentioned';
    }
    if (metricId === 'people_ratio') {
      return 'Not clearly mentioned';
    }

    return 'Not clearly mentioned';
  }

  scrollToTable() {
    const el = document.getElementById('compare-table');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  toggleFivePoints() {
    if (this.fivePointsOpen) { this.fivePointsOpen = false; return; }
    if (this.fivePointsLoading) return;
    this.fivePointsLoading = true;
    setTimeout(() => { this.fivePointsLoading = false; this.fivePointsOpen = true; }, 360);
  }

  toggleRedFlags() {
    if (this.rfLoading) return;
    if (this.rfOpen && this.rfLoaded) { this.rfOpen = false; return; }
    if (this.rfError) { this.rfError = false; }
    const sessionId = this.homeScan?.sessionId;
    if (!sessionId) return;
    if (this.rfLoaded && this.rfCachedSessionId === sessionId) { this.rfOpen = true; return; }
    this.rfLoading = true;
    this.rfOpen = true;
    this.scanService.getRedFlags(sessionId).subscribe({
      next: (res: RedFlagsResponse) => { this.rfFlags = res.flags; this.rfLoaded = true; this.rfLoading = false; this.rfCachedSessionId = sessionId; },
      error: () => { this.rfError = true; this.rfLoading = false; },
    });
  }

  getFivePoints(scan: ScanResponse | null): Array<{ icon: string; text: string; source: string }> {
    if (!scan || !this.isTerminal(scan.status)) return [];
    const points: Array<{ icon: string; text: string; source: string }> = [];
    const ei = scan.earlyIdentity;

    const uniquePoint = this.getDistinctivePoint(scan);
    if (uniquePoint) points.push(uniquePoint);

    // 1. Board / curriculum
    const board = this.inferBoard(scan);
    if (board) points.push({ icon: '📚', text: `Follows the ${board} curriculum.`, source: 'Classified from website content' });

    // 2. Safety signals
    const safety = scan.safetyScore;
    if (safety) {
      const found: string[] = [];
      if ((safety.items as any).cctvMention?.status === 'found') found.push('CCTV surveillance');
      if ((safety.items as any).fireCertificate?.status === 'found') found.push('fire safety certificate');
      if ((safety.items as any).antiBullyingPolicy?.status === 'found') found.push('anti-bullying policy');
      if ((safety.items as any).sanitaryCertificate?.status === 'found') found.push('sanitary certificate');
      if (found.length > 0) {
        points.push({ icon: '🛡️', text: `Safety disclosures found: ${found.join(', ')}.`, source: 'Crawled from school website' });
      } else {
        points.push({ icon: '⚠️', text: 'No safety disclosures (CCTV, fire NOC, anti-bullying) clearly mentioned on the website.', source: 'Crawled from school website' });
      }
    }

    // 3. Fee transparency
    const clarity = scan.clarityScore;
    if (clarity) {
      if (clarity.items.feeClarity) {
        points.push({ icon: '💰', text: 'Fee schedule is publicly visible on the website.', source: 'Crawled from school website' });
      } else {
        points.push({ icon: '💰', text: 'Fee details were not clearly mentioned on the website. Ask the school directly.', source: 'Crawled from school website' });
      }
    }

    // 4. Contact info
    if (ei) {
      const contact: string[] = [];
      const phones = Array.isArray((ei as any).phones) ? (ei as any).phones.filter((p: unknown) => !!p) : [];
      if (phones.length > 0) contact.push(`phones (${phones.slice(0, 2).join(', ')})`);
      else if (ei.phone) contact.push(`phone (${ei.phone})`);
      if (ei.email) contact.push('email');
      if (ei.address) contact.push('address');
      if (contact.length > 0) points.push({ icon: '📞', text: `Contact info available: ${contact.join(', ')}.`, source: 'Extracted from school website' });
    }

    // 5. Principal / results
    if (ei?.principalName) {
      points.push({ icon: '👤', text: `Principal: ${ei.principalName}.`, source: 'Extracted from school website' });
    } else if (clarity?.items.resultsPublished) {
      points.push({ icon: '📊', text: 'Exam results are publicly available on the website.', source: 'Crawled from school website' });
    }

    return points.slice(0, 5);
  }

  private getDistinctivePoint(scan: ScanResponse): { icon: string; text: string; source: string } | null {
    const ei = scan.earlyIdentity as any;
    if (!ei) return null;
    const facilities = Array.isArray(ei.facilities) ? ei.facilities.map((f: unknown) => String(f)).filter(Boolean) : [];
    if (facilities.length > 0) {
      return {
        icon: '✨',
        text: `Distinctive campus details published: ${facilities.slice(0, 3).join(', ')}.`,
        source: 'Extracted from school website',
      };
    }
    if (ei.foundingYear) {
      return {
        icon: '🏫',
        text: `Established in ${ei.foundingYear} (published on school website).`,
        source: 'Extracted from school website',
      };
    }
    if (ei.principalName) {
      return {
        icon: '👤',
        text: `Leadership detail available: Principal ${ei.principalName}.`,
        source: 'Extracted from school website',
      };
    }
    return null;
  }

  get anySlotInProgress(): boolean {
    return this.filledSlots.some(s => this.isInProgress(s.item?.status || ''));
  }

  get comparingBlockedBy(): string {
    const b = this.filledSlots.find(s => this.isInProgress(s.item?.status || ''));
    return b ? (this.getSlotDisplayName(b) || 'school') : '';
  }

  truncateName(name: string, maxLen = 22): string {
    if (!name || name.length <= maxLen) return name;
    return name.slice(0, maxLen) + '\u2026';
  }

  scrollToSection(sectionId: string) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  triggerAskAi(question: string) {
    if (!this.homeAskBox) return;
    this.homeAskBox.askQuestion(question);
    // Scroll to ask-box
    setTimeout(() => {
      const el = document.querySelector('app-ask-box');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  metricState(metricId: string, scan: ScanResponse): 'disclosed' | 'not_disclosed' | 'not_found' | 'unreadable' | 'in_progress' {
    if (!scan || !scan.status) return 'in_progress';
    if (!this.isTerminal(scan.status)) return 'in_progress';

    const v = this.metricValue(metricId, scan);
    if (v === 'In progress') return 'in_progress';
    if (v === 'Not clearly mentioned') return 'not_found';
    return 'disclosed';
  }

  stateLabel(state: 'disclosed' | 'not_disclosed' | 'not_found' | 'unreadable' | 'in_progress'): string {
    switch (state) {
      case 'disclosed': return 'Disclosed';
      case 'not_disclosed': return 'Not Disclosed';
      case 'unreadable': return 'Unreadable';
      case 'in_progress': return 'In progress';
      case 'not_found': return 'Not clearly mentioned';
    }
  }

  stateClass(state: string): string {
    return state;
  }

  cellClass(state: string): string {
    if (state === 'disclosed') return 'cell-found';
    if (state === 'not_found') return 'cell-missing';
    if (state === 'in_progress') return 'cell-progress';
    return '';
  }

  getCellClasses(metricId: string, scan: ScanResponse): string {
    const baseClass = this.cellClass(this.metricState(metricId, scan));
    
    // Special color coding for transparency score
    if (metricId === 'transparency_score' && scan && this.isTerminal(scan.status)) {
      const score = scan.overallScore ?? 0;
      if (score > 0) {
        if (score <= 33) return `${baseClass} score-red`;
        if (score <= 66) return `${baseClass} score-orange`;
        return `${baseClass} score-green`;
      }
    }
    
    return baseClass;
  }

  private cleanSchoolName(name: string | undefined | null): string {
    if (!name) return 'Unknown';
    
    let cleaned = name;
    
    // Step 1: Remove common prefixes
    cleaned = cleaned
      .replace(/^(Homepage?\s*[-–—]\s*|Home\s*[-–—]\s*|Welcome\s+to\s+)/i, '')
      .trim();
    
    // Step 2: Fix concatenated board names (e.g., "CBSESharp" -> "CBSE Sharp")
    // This helps separate board from accidentally joined text
    cleaned = cleaned
      .replace(/(CBSE|ICSE|IB|IGCSE)([A-Z][a-z])/g, '$1 $2')
      .trim();
    
    // Step 3: Remove chat widget and third-party tool suffixes
    cleaned = cleaned
      .replace(/\s*(Sharp\s*(AI)?\s*(Chat)?\s*(Widget)?|Chat\s+Widget|Chatbot|Live\s+Chat|WhatsApp\s+Chat).*$/i, '')
      .trim();
    
    // Step 4: Remove marketing suffixes like "- Best CBSE School in...", ", Best School..."
    cleaned = cleaned
      .replace(/\s*[-–—]\s*(Best|Top|Leading|Premier|No\.?\s*1|#1).*$/i, '')
      .replace(/,\s*(Best|Top|Leading|Premier|#1).*$/i, '')
      .trim();
    
    // Step 5: Remove trailing board mentions if duplicated (e.g., "School CBSE" when board shows separately)
    // But keep it if it's part of the name like "CBSE School"
    cleaned = cleaned
      .replace(/\s+(CBSE|ICSE|IB|IGCSE)$/i, '')
      .trim();
    
    // Step 6: Clean up any double spaces or trailing punctuation
    cleaned = cleaned
      .replace(/\s{2,}/g, ' ')
      .replace(/[-–—,|:]+$/, '')
      .trim();
    
    return cleaned || name;
  }

  displayName(name: string | undefined | null): string {
    return this.cleanSchoolName(name);
  }

  getSlotDisplayName(slot: CompareListSlot): string {
    // Prefer the extracted school name from scan's earlyIdentity
    if (slot.item?.sessionId) {
      const scan = this.getScan(slot.item.sessionId);
      if (scan?.earlyIdentity?.schoolName) {
        return this.cleanSchoolName(scan.earlyIdentity.schoolName);
      }
    }
    // Fallback to stored name
    return this.cleanSchoolName(slot.item?.schoolName || '');
  }

  private inferBoard(scan: ScanResponse): string | null {
    const keywords = (scan.classification?.matchedKeywords ?? []).map((k) => String(k).toLowerCase());
    const combined = `${scan.url || ''} ${scan.summary || ''} ${(scan.earlyIdentity?.schoolName || '')}`.toLowerCase();
    if (keywords.some((k) => k.includes('cbse'))) return 'CBSE';
    if (/\bcbse\b/.test(combined)) return 'CBSE';
    if (keywords.some((k) => k.includes('icse') || k.includes('isc'))) return 'ICSE';
    if (/\bicse\b|\bisc\b/.test(combined)) return 'ICSE';
    if (keywords.some((k) => k.includes('ib') || k.includes('international baccalaureate'))) return 'IB';
    if (/\binternational baccalaureate\b|\bib[-\s]?(pyp|myp|dp)?\b/.test(combined)) return 'IB';
    if (keywords.some((k) => k.includes('igcse') || k.includes('cambridge'))) return 'IGCSE';
    if (/\bigcse\b|\bcambridge\b/.test(combined)) return 'IGCSE';
    if (keywords.some((k) => k.includes('state board'))) return 'State Board';
    if (/\bstate board\b/.test(combined)) return 'State Board';
    return null;
  }
}
