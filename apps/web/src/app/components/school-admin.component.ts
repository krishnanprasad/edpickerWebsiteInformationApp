import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, last, Observable, of, switchMap } from 'rxjs';
import { ScanResponse, SchoolInfoCoreResponse } from '../models/scan.models';
import { ScanService } from '../services/scan.service';

type AdminPanel = 'parents' | 'core' | 'cbse' | 'competitors';
type ParentCategoryKey = 'academic' | 'safety' | 'parent' | 'holistic' | 'practical';

interface ParentQuestionRule {
  id: string;
  question: string;
  isAnswered: (scan: ScanResponse) => boolean;
}

interface ParentCategoryView {
  key: ParentCategoryKey;
  label: string;
  totalQuestions: number;
  answeredQuestions: number;
  items: Array<{ question: string; answered: boolean }>;
}

const ACADEMIC_RULES: ParentQuestionRule[] = [
  { id: 'board', question: 'What board is the school affiliated to (CBSE/ICSE/IB)?', isAnswered: (s) => !!s.classification?.matchedKeywords?.length },
  { id: 'board_result_percent', question: 'What is the average Class 10 & 12 board result percentage?', isAnswered: (s) => !!s.clarityScore?.items.resultsPublished },
  { id: 'highest_marks', question: 'What is the highest mark scored in recent years?', isAnswered: (s) => !!s.clarityScore?.items.resultsPublished },
  { id: 'foundation_program', question: 'Do you provide NEET/JEE foundation programs?', isAnswered: (s) => /neet|jee|foundation/i.test(s.summary || '') },
  { id: 'class_size', question: 'How many students are there per class?', isAnswered: (s) => /students?\s+per\s+class|class\s+strength/i.test(s.summary || '') },
  { id: 'student_teacher_ratio', question: 'What is the student-teacher ratio?', isAnswered: (s) => /student[-\s]?teacher\s+ratio/i.test(s.summary || '') },
  { id: 'qualified_teachers', question: 'Are teachers experienced and qualified?', isAnswered: (s) => /qualified\s+teachers?|experienced\s+teachers?/i.test(s.summary || '') },
  { id: 'subject_wise_teachers', question: 'Do you have subject-wise teachers from middle school?', isAnswered: (s) => /subject[-\s]?wise\s+teachers?/i.test(s.summary || '') },
  { id: 'smart_class', question: 'Do you use smart boards / digital classrooms?', isAnswered: (s) => /smart\s+class|digital\s+class/i.test(s.summary || '') },
  { id: 'assessment_model', question: 'Is there continuous assessment or only final exams?', isAnswered: (s) => /continuous\s+assessment|assessment/i.test(s.summary || '') },
  { id: 'weak_student_support', question: 'How do you support weak students academically?', isAnswered: (s) => /remedial|support\s+students|weak\s+students?/i.test(s.summary || '') },
  { id: 'olympiad_training', question: 'Do you provide Olympiad / competitive exam training?', isAnswered: (s) => /olympiad|competitive\s+exam/i.test(s.summary || '') },
  { id: 'foreign_languages', question: 'What foreign languages are offered?', isAnswered: (s) => /foreign\s+language|french|german|spanish/i.test(s.summary || '') },
  { id: 'career_prep', question: 'How do you prepare students for 21st-century careers?', isAnswered: (s) => /career|future\s+ready|21st/i.test(s.summary || '') },
  { id: 'top_college_outcomes', question: 'Do students get into top colleges after graduating?', isAnswered: (s) => !!s.clarityScore?.items.resultsPublished },
];

const SAFETY_RULES: ParentQuestionRule[] = [
  { id: 'cctv', question: 'Is the campus covered with CCTV?', isAnswered: (s) => s.safetyScore?.items.cctvMention.status === 'found' },
  { id: 'fire_drill', question: 'Do you conduct regular fire drills?', isAnswered: (s) => /fire\s+drill/i.test(s.summary || '') },
  { id: 'fire_certificate', question: 'Do you have a valid Fire Safety certificate?', isAnswered: (s) => s.safetyScore?.items.fireCertificate.status === 'found' },
  { id: 'building_safety', question: 'Is the school building structurally safe?', isAnswered: (s) => !!s.mandatoryDocuments?.some((d) => /building safety/i.test(d.name) && d.status === 'present') },
  { id: 'sanitary_certificate', question: 'Do you have a sanitary / health certificate?', isAnswered: (s) => s.safetyScore?.items.sanitaryCertificate.status === 'found' },
  { id: 'nurse_doctor', question: 'Is there a full-time nurse or doctor?', isAnswered: (s) => /nurse|doctor|medical\s+room/i.test(s.summary || '') },
  { id: 'gps_bus', question: 'Are buses GPS-enabled?', isAnswered: (s) => /gps/i.test(s.summary || '') || s.safetyScore?.items.transportSafety.status === 'found' },
  { id: 'female_staff', question: 'Is there a female staff presence in primary sections?', isAnswered: (s) => /female\s+staff/i.test(s.summary || '') },
  { id: 'visitor_entry', question: 'What is the visitor entry process?', isAnswered: (s) => /visitor\s+entry|entry\s+process/i.test(s.summary || '') },
  { id: 'dispersal_security', question: 'Is the campus secure during dispersal time?', isAnswered: (s) => /dispersal|security/i.test(s.summary || '') },
  { id: 'anti_bullying', question: 'Do you have anti-bullying policies?', isAnswered: (s) => s.safetyScore?.items.antiBullyingPolicy.status === 'found' },
  { id: 'grievance_pta', question: 'Do you have grievance redressal or PTA involvement?', isAnswered: (s) => /grievance|pta/i.test(s.summary || '') },
];

const PARENT_RULES: ParentQuestionRule[] = [
  { id: 'parent_portal', question: 'Is there a Parent Portal or mobile app?', isAnswered: (s) => /parent\s+portal|mobile\s+app/i.test(s.summary || '') },
  { id: 'teacher_communication', question: 'How often do teachers communicate progress?', isAnswered: (s) => /communicat|progress\s+report/i.test(s.summary || '') },
  { id: 'ptm', question: 'Do you conduct regular PTMs?', isAnswered: (s) => /ptm|parent\s+teacher/i.test(s.summary || '') },
  { id: 'attendance_tracking', question: 'Can parents track attendance online?', isAnswered: (s) => /attendance\s+online|attendance\s+track/i.test(s.summary || '') },
  { id: 'digital_homework', question: 'Are homework and notices updated digitally?', isAnswered: (s) => /homework|notices?\s+updated|digital/i.test(s.summary || '') },
  { id: 'complaint_response', question: 'How responsive is the school to parent complaints?', isAnswered: (s) => /complaint|grievance/i.test(s.summary || '') },
  { id: 'whatsapp_group', question: 'Is there a WhatsApp / communication group system?', isAnswered: (s) => /whatsapp|communication\s+group/i.test(s.summary || '') },
  { id: 'parent_involvement', question: 'Are parents involved in events or school decisions?', isAnswered: (s) => /parent\s+involved|pta|events/i.test(s.summary || '') },
];

const HOLISTIC_RULES: ParentQuestionRule[] = [
  { id: 'sports_facilities', question: 'What sports facilities are available?', isAnswered: (s) => /sports?\s+facilit|playground/i.test(s.summary || '') },
  { id: 'sports_coaching', question: 'Is there professional sports coaching?', isAnswered: (s) => /sports?\s+coach/i.test(s.summary || '') },
  { id: 'inter_school', question: 'Do you participate in inter-school competitions?', isAnswered: (s) => /inter[-\s]?school|competition/i.test(s.summary || '') },
  { id: 'clubs', question: 'Are there clubs (coding, robotics, music, drama)?', isAnswered: (s) => /club|coding|robotics|music|drama/i.test(s.summary || '') },
  { id: 'field_trips', question: 'Do students go on field trips or excursions?', isAnswered: (s) => /field\s+trip|excursion/i.test(s.summary || '') },
  { id: 'exchange_program', question: 'Are there international exchange programs (IB schools)?', isAnswered: (s) => /international\s+exchange/i.test(s.summary || '') },
  { id: 'student_council', question: 'Is leadership (student council) encouraged?', isAnswered: (s) => /student\s+council|leadership/i.test(s.summary || '') },
  { id: 'achievement_publish', question: 'Are achievements regularly recognized and published?', isAnswered: (s) => !!s.clarityScore?.items.resultsPublished || /achievement/i.test(s.summary || '') },
];

const PRACTICAL_RULES: ParentQuestionRule[] = [
  { id: 'annual_fee', question: 'What is the total annual fee structure?', isAnswered: (s) => !!s.clarityScore?.items.feeClarity },
  { id: 'hidden_charges', question: 'Are there hidden charges beyond tuition?', isAnswered: (s) => /hidden\s+charges?|fee\s+breakup/i.test(s.summary || '') },
  { id: 'scholarships', question: 'Do you offer scholarships?', isAnswered: (s) => /scholarship/i.test(s.summary || '') },
  { id: 'school_comparison', question: 'How does your school compare to other schools nearby?', isAnswered: (s) => (s.overallScore ?? 0) > 0 },
  { id: 'transport_location', question: 'Is transport available near my location?', isAnswered: (s) => s.safetyScore?.items.transportSafety.status === 'found' },
  { id: 'school_timings', question: 'What are the school timings?', isAnswered: (s) => /school\s+timings?/i.test(s.summary || '') },
  { id: 'differentiator', question: 'What makes your school different from competitors?', isAnswered: (s) => !!s.summary && s.summary.length > 60 },
];

@Component({
  selector: 'app-school-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="admin-shell">
      <header class="admin-header">
        <div>
          <h1>School Admin Console</h1>
          <p>Demo-ready flow for school stakeholders and sales discussions.</p>
        </div>
        <a class="home-link" href="/">Back to Home</a>
      </header>

      <section class="input-card">
        <label for="school-url">School Website URL</label>
        <input
          id="school-url"
          type="url"
          [(ngModel)]="primaryUrl"
          placeholder="https://example-school.edu.in"
        />

        <div class="btn-row">
          <button class="btn btn-parents" [class.btn-loading]="loading && activePanel === 'parents'" (click)="runParentsInfoReport()" [disabled]="loading">
            <span class="btn-inner" [style.opacity]="loading && activePanel === 'parents' ? 0 : 1">1. Parents Information Score</span>
            <span class="five-dots" *ngIf="loading && activePanel === 'parents'" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
          <button class="btn btn-core" [class.btn-loading]="loading && activePanel === 'core'" (click)="runSchoolInfoCoreReport()" [disabled]="loading">
            <span class="btn-inner" [style.opacity]="loading && activePanel === 'core' ? 0 : 1">2. Category Based Score</span>
            <span class="five-dots" *ngIf="loading && activePanel === 'core'" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
          <button class="btn btn-cbse btn-disabled" disabled title="CBSE report is temporarily disabled">
            <span class="btn-inner">3. CBSE Compliance Report</span>
          </button>
          <button class="btn btn-compare" (click)="activateCompetitorPanel()">
            4. Competitor Comparison
          </button>
        </div>
        <button class="btn btn-full-report" (click)="openFullReportModal()" [disabled]="loading">
          <span class="lock-icon" aria-hidden="true"></span>FULL Report - 100 Points
        </button>

        <p class="error" *ngIf="error">{{ error }}</p>
      </section>

      <section class="panel school-identity" *ngIf="latestScan">
        <h2>{{ schoolDisplayName }}</h2>
        <p class="sub" *ngIf="schoolDisplayAddress">{{ schoolDisplayAddress }}</p>
      </section>

      <section class="panel" *ngIf="activePanel === 'parents' && latestScan">
        <h2>Parents Information Score</h2>
        <div class="loading-panel" *ngIf="loading">
          <div class="skel-row" *ngFor="let _ of [0,1,2]">
            <div class="skel-badge"></div>
            <div class="skel-lines"><div class="skel-line long"></div><div class="skel-line short"></div></div>
          </div>
        </div>
        <div class="score-grid">
          <div class="score-box">
            <div class="score-label">Transparency Score</div>
            <div class="score-value">{{ latestScan.overallScore ?? 0 }}/100</div>
          </div>
          <div class="score-box">
            <div class="score-label">Clarity Score</div>
            <div class="score-value">{{ latestScan.clarityScore?.total ?? 0 }}/100</div>
          </div>
          <div class="score-box">
            <div class="score-label">Safety Score</div>
            <div class="score-value">{{ latestScan.safetyScore?.total ?? 0 }}/100</div>
          </div>
        </div>

        <div class="checklist">
          <h3>AEO / AIO / GEO Readiness</h3>
          <div class="check-item" *ngFor="let item of readinessChecks(latestScan)">
            <span class="status" [class.ok]="item.ok" [class.bad]="!item.ok">{{ item.ok ? 'OK' : 'Missing' }}</span>
            <span>{{ item.label }}</span>
          </div>
        </div>

        <div class="coverage-banner">
          Parents typically search for <b>100+ questions</b> before shortlisting a school.
          Based on your current website transparency, you are covering about
          <b>{{ parentCoveragePercent(latestScan) }}%</b> of expected parent queries.
        </div>

        <div class="question-grid">
          <div class="question-card" *ngFor="let cat of parentQuestionCategories(latestScan)">
            <div class="q-head">
              <h3>{{ cat.label }}</h3>
              <span class="q-score">{{ cat.answeredQuestions }}/{{ cat.totalQuestions }}</span>
            </div>
            <div class="q-row" *ngFor="let q of cat.items">
              <span class="q-pill" [class.q-ok]="q.answered" [class.q-miss]="!q.answered">{{ q.answered ? 'Covered' : 'Missing' }}</span>
              <span>{{ q.question }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" *ngIf="activePanel === 'core' && latestScan">
        <h2>Category Based Score</h2>
        <p class="sub">10 categories. For each category, the report highlights important information that is missing or weak on the website.</p>
        <div class="loading-panel" *ngIf="coreLoading">
          <div class="skel-row" *ngFor="let _ of [0,1,2]">
            <div class="skel-badge"></div>
            <div class="skel-lines"><div class="skel-line long"></div><div class="skel-line short"></div></div>
          </div>
        </div>
        <ng-container *ngIf="!coreLoading && coreReport">
          <div class="gauge-grid">
            <div class="gauge-card">
              <div class="gauge-title">Full Page Percent</div>
              <div class="gauge-wrap">
                <div class="gauge-arc"></div>
                <div class="gauge-center"></div>
                <div class="gauge-needle" [style.transform]="'translateX(-50%) rotate(' + gaugeRotation(coreReport.percent) + 'deg)'"></div>
              </div>
              <div class="gauge-value">{{ coreReport.percent }}/100</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-title">Transparency</div>
              <div class="gauge-wrap">
                <div class="gauge-arc"></div>
                <div class="gauge-center"></div>
                <div class="gauge-needle" [style.transform]="'translateX(-50%) rotate(' + gaugeRotation(latestScan.overallScore || 0) + 'deg)'"></div>
              </div>
              <div class="gauge-value">{{ latestScan.overallScore || 0 }}/100</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-title">Clarity</div>
              <div class="gauge-wrap">
                <div class="gauge-arc"></div>
                <div class="gauge-center"></div>
                <div class="gauge-needle" [style.transform]="'translateX(-50%) rotate(' + gaugeRotation(latestScan.clarityScore?.total || 0) + 'deg)'"></div>
              </div>
              <div class="gauge-value">{{ latestScan.clarityScore?.total || 0 }}/100</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-title">Safety</div>
              <div class="gauge-wrap">
                <div class="gauge-arc"></div>
                <div class="gauge-center"></div>
                <div class="gauge-needle" [style.transform]="'translateX(-50%) rotate(' + gaugeRotation(latestScan.safetyScore?.total || 0) + 'deg)'"></div>
              </div>
              <div class="gauge-value">{{ latestScan.safetyScore?.total || 0 }}/100</div>
            </div>
          </div>

          <div class="score-grid">
            <div class="score-box">
              <div class="score-label">Core Score</div>
              <div class="score-value">{{ coreReport.totalScore }}/{{ coreReport.maxScore }}</div>
            </div>
            <div class="score-box">
              <div class="score-label">Full Page Report</div>
              <div class="score-value">{{ coreReport.percent }}/100</div>
            </div>
            <div class="score-box">
              <div class="score-label">Band</div>
              <div class="score-value">{{ coreReport.label }}</div>
            </div>
          </div>
          <p class="sub" style="margin-top:10px;">{{ coreReport.summary }}</p>
          <table class="report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Category</th>
                <th>Score (0-5)</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of coreReport.categories">
                <td>{{ c.categoryNumber }}</td>
                <td>{{ c.categoryName }}</td>
                <td>{{ c.score }}</td>
                <td><span class="pill" [class.present]="c.status === 'strong_found'" [class.review]="c.status === 'partial' || c.status === 'weak_found'" [class.missing]="c.status === 'missing'">{{ coreStatusLabel(c.status) }}</span></td>
                <td>{{ c.reason }}</td>
                <td>{{ c.evidence }}</td>
              </tr>
            </tbody>
          </table>
        </ng-container>
      </section>

      <section class="panel" *ngIf="activePanel === 'cbse' && latestScan">
        <h2>CBSE Compliance Report</h2>
        <div class="cbse-highlight">
          CBSE expectation: the homepage should clearly expose a link named <b>Mandatory Disclosure</b> (or <b>Mandatory Public Disclosure</b>).
        </div>
        <div class="cbse-warning" *ngIf="allDocsMissing(latestScan)">
          All documents currently look missing. This can also happen when disclosure links are wrong, renamed, or not reachable. Please verify disclosure links manually before finalizing.
        </div>
        <div class="cbse-warning" *ngIf="hasUnreachableLinks(latestScan)">
          One or more disclosure links are marked as not reachable. We have flagged these as <b>needs_review</b> to avoid wrong reporting.
        </div>
        <div class="loading-panel" *ngIf="loading">
          <div class="skel-row" *ngFor="let _ of [0,1,2]">
            <div class="skel-badge"></div>
            <div class="skel-lines"><div class="skel-line long"></div><div class="skel-line short"></div></div>
          </div>
        </div>
        <p class="sub" *ngIf="latestScan.documentReviewMessage">{{ latestScan.documentReviewMessage }}</p>
        <table class="report-table" *ngIf="latestScan.mandatoryDocuments?.length; else noCbseData">
          <thead>
            <tr>
              <th>Document</th>
              <th>Status</th>
              <th>Expiry</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let d of latestScan.mandatoryDocuments">
              <td>{{ d.name }}</td>
              <td>
                <span class="pill" [class.present]="d.status === 'present'" [class.missing]="d.status === 'missing'" [class.review]="d.status === 'needs_review'">
                  {{ d.status }}
                </span>
              </td>
              <td>{{ d.expiryDate || '-' }}</td>
              <td>{{ d.reviewMessage || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <ng-template #noCbseData>
          <p class="sub">No mandatory document audit found yet for this scan.</p>
        </ng-template>
      </section>

      <section class="panel" *ngIf="activePanel === 'competitors'">
        <h2>Competitor Comparison</h2>
        <p class="sub">Enter 3 school URLs for side-by-side score comparison.</p>
        <div class="comp-inputs">
          <input type="url" [(ngModel)]="competitorUrls[0]" placeholder="School 1 URL" />
          <input type="url" [(ngModel)]="competitorUrls[1]" placeholder="School 2 URL" />
          <input type="url" [(ngModel)]="competitorUrls[2]" placeholder="School 3 URL" />
        </div>
        <button class="btn btn-compare" [class.btn-loading]="compareLoading" (click)="runCompetitorComparison()" [disabled]="compareLoading">
          <span class="btn-inner" [style.opacity]="compareLoading ? 0 : 1">Run Comparison</span>
          <span class="five-dots" *ngIf="compareLoading" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>

        <div class="loading-panel" *ngIf="compareLoading">
          <div class="skel-row" *ngFor="let _ of [0,1,2]">
            <div class="skel-badge"></div>
            <div class="skel-lines"><div class="skel-line long"></div><div class="skel-line short"></div></div>
          </div>
        </div>

        <table class="report-table" *ngIf="competitorResults.length">
          <thead>
            <tr>
              <th>School URL</th>
              <th>Status</th>
              <th>Overall</th>
              <th>Clarity</th>
              <th>Safety</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let r of competitorResults">
              <td>{{ r.url }}</td>
              <td>{{ r.status }}</td>
              <td>{{ r.overallScore ?? '-' }}</td>
              <td>{{ r.clarityScore?.total ?? '-' }}</td>
              <td>{{ r.safetyScore?.total ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div class="modal-backdrop" *ngIf="showCorePasscodeModal">
        <div class="modal-card">
          <h3>Enter 6-digit passcode</h3>
          <p class="sub">This report is locked. Enter admin passcode to continue.</p>
          <input
            type="password"
            inputmode="numeric"
            maxlength="6"
            [(ngModel)]="corePasscode"
            placeholder="******"
          />
          <p class="error" *ngIf="corePasscodeError">{{ corePasscodeError }}</p>
          <div class="modal-actions">
            <button class="btn btn-cancel" (click)="closeCorePasscodeModal()" [disabled]="corePasscodeSubmitting">Cancel</button>
            <button class="btn btn-core" (click)="confirmCorePasscode()" [disabled]="corePasscodeSubmitting">{{ corePasscodeSubmitting ? 'Verifying...' : 'Unlock Report' }}</button>
          </div>
        </div>
      </div>
    </main>
  `,
  styles: [`
    .admin-shell { max-width: 1120px; margin: 0 auto; padding: 20px; color: #13293d; }
    .admin-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .admin-header h1 { margin: 0; font-size: 32px; }
    .admin-header p { margin: 8px 0 0; color: #415a77; }
    .home-link { color: #0f766e; text-decoration: none; font-weight: 700; white-space: nowrap; margin-top: 6px; }
    .input-card, .panel { background: #fff; border: 1px solid #d8e2ec; border-radius: 14px; padding: 16px; margin-top: 14px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #b9c9d8; border-radius: 10px; padding: 10px 12px; font-size: 14px; }
    .btn-row { margin-top: 12px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .btn { border: 0; border-radius: 10px; padding: 10px 12px; font-weight: 700; color: #fff; cursor: pointer; position: relative; min-height: 40px; }
    .btn:disabled { opacity: 0.7; cursor: not-allowed; }
    .btn-loading { box-shadow: 0 0 0 1.5px rgba(255,255,255,0.5) inset; }
    .btn-inner { transition: opacity 0.15s; }
    .lock-icon {
      display: inline-block;
      width: 12px;
      height: 10px;
      border: 2px solid rgba(255,255,255,0.95);
      border-radius: 2px;
      margin-right: 8px;
      position: relative;
      top: 1px;
    }
    .lock-icon::before {
      content: '';
      position: absolute;
      left: 1px;
      top: -8px;
      width: 6px;
      height: 6px;
      border: 2px solid rgba(255,255,255,0.95);
      border-bottom: 0;
      border-radius: 6px 6px 0 0;
    }
    .btn-parents { background: #0f766e; }
    .btn-core { background: #0e7490; }
    .btn-cbse { background: #1d4ed8; }
    .btn-compare { background: #b45309; margin-top: 12px; }
    .btn-full-report { background: #b91c1c; margin-top: 12px; width: 100%; }
    .btn-disabled { background: #94a3b8; color: #f8fafc; cursor: not-allowed; }
    .error { color: #b91c1c; margin-top: 10px; }
    .score-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .score-box { border: 1px solid #d4e2ee; border-radius: 10px; padding: 10px; background: #f8fbff; }
    .score-label { color: #4b6478; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .score-value { font-size: 24px; font-weight: 800; margin-top: 4px; }
    .checklist { margin-top: 14px; }
    .check-item { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .status { font-size: 12px; padding: 2px 8px; border-radius: 999px; font-weight: 700; }
    .status.ok { background: #dcfce7; color: #166534; }
    .status.bad { background: #fee2e2; color: #991b1b; }
    .coverage-banner { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #14532d; font-size: 13px; }
    .question-grid { margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .question-card { border: 1px solid #d4e2ee; border-radius: 10px; padding: 10px; background: #fcfdff; }
    .q-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .q-head h3 { margin: 0; font-size: 14px; }
    .q-score { font-size: 12px; font-weight: 700; color: #1d4ed8; background: #dbeafe; border-radius: 999px; padding: 2px 8px; }
    .q-row { display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; font-size: 13px; }
    .q-pill { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 7px; white-space: nowrap; margin-top: 1px; }
    .q-pill.q-ok { background: #dcfce7; color: #166534; }
    .q-pill.q-miss { background: #fee2e2; color: #991b1b; }
    .sub { color: #4b6478; margin: 0 0 10px; }
    .school-identity h2 { margin: 0; font-size: 24px; }
    .gauge-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .gauge-card { border: 1px solid #d4e2ee; border-radius: 10px; padding: 10px; background: #fcfdff; text-align: center; }
    .gauge-title { font-size: 12px; color: #4b6478; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
    .gauge-wrap { width: 130px; height: 70px; margin: 6px auto 4px; position: relative; overflow: hidden; }
    .gauge-arc {
      width: 130px; height: 130px; border-radius: 50%;
      background: conic-gradient(from 180deg, #dc2626 0deg 36deg, #f97316 36deg 72deg, #facc15 72deg 108deg, #a3e635 108deg 144deg, #22c55e 144deg 180deg, transparent 180deg 360deg);
      position: absolute; left: 0; top: 0;
    }
    .gauge-center {
      width: 86px; height: 86px; border-radius: 50%; background: #fff;
      position: absolute; left: 22px; top: 44px; border: 1px solid #e5edf4;
    }
    .gauge-needle {
      position: absolute; left: 50%; bottom: 6px; width: 2px; height: 56px;
      background: #111827; transform-origin: bottom center; transition: transform 0.25s ease;
    }
    .gauge-needle::after {
      content: ''; width: 10px; height: 10px; background: #111827; border-radius: 50%;
      position: absolute; left: -4px; bottom: -2px;
    }
    .gauge-value { font-size: 18px; font-weight: 800; color: #0f172a; }
    .cbse-highlight { margin: 0 0 10px; padding: 10px 12px; border-radius: 10px; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; font-size: 13px; }
    .cbse-warning { margin: 0 0 10px; padding: 10px 12px; border-radius: 10px; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-size: 13px; }
    .report-table { width: 100%; border-collapse: collapse; }
    .report-table th, .report-table td { border-bottom: 1px solid #e2e8f0; text-align: left; padding: 8px 6px; vertical-align: top; }
    .pill { border-radius: 999px; font-size: 12px; font-weight: 700; padding: 2px 8px; text-transform: uppercase; letter-spacing: 0.03em; }
    .pill.present { background: #dcfce7; color: #166534; }
    .pill.missing { background: #fee2e2; color: #991b1b; }
    .pill.review { background: #fef3c7; color: #92400e; }
    .comp-inputs { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 4px; }
    .loading-panel { margin-bottom: 10px; }
    .five-dots { display: flex; gap: 3px; align-items: center; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
    .five-dots span { width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: dotbounce 0.9s ease-in-out infinite; }
    .five-dots span:nth-child(1) { animation-delay: 0s; }
    .five-dots span:nth-child(2) { animation-delay: 0.18s; }
    .five-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes dotbounce { 0%,60%,100% { transform:translateY(0);opacity:.7 } 30% { transform:translateY(-4px);opacity:1 } }
    .skel-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; background: #fafafa; margin-top: 8px; }
    .skel-badge { width: 50px; height: 20px; border-radius: 6px; background: linear-gradient(90deg,#e0e0e0 25%,#eeeeee 50%,#e0e0e0 75%); background-size:200% 100%; animation:skelsh 1.4s infinite; flex-shrink:0; }
    .skel-lines { flex:1; display:flex; flex-direction:column; gap:7px; padding-top:2px; }
    .skel-line { height:11px; border-radius:4px; background:linear-gradient(90deg,#e0e0e0 25%,#eeeeee 50%,#e0e0e0 75%); background-size:200% 100%; animation:skelsh 1.4s infinite; }
    .skel-line.long { width:80%; } .skel-line.short { width:55%; animation-delay:0.15s; }
    @keyframes skelsh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(2,6,23,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-card {
      width: min(92vw, 420px); background: #fff; border-radius: 12px; border: 1px solid #d4e2ee; padding: 16px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
    }
    .modal-card h3 { margin: 0 0 8px; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .btn-cancel { background: #475569; }
    @media (max-width: 900px) {
      .btn-row { grid-template-columns: 1fr; }
      .admin-header { flex-direction: column; }
      .score-grid { grid-template-columns: 1fr; }
      .question-grid { grid-template-columns: 1fr; }
      .gauge-grid { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class SchoolAdminComponent {
  private readonly scanService = inject(ScanService);

  primaryUrl = '';
  activePanel: AdminPanel = 'parents';
  loading = false;
  compareLoading = false;
  coreLoading = false;
  error = '';
  latestScan: ScanResponse | null = null;
  coreReport: SchoolInfoCoreResponse | null = null;
  showCorePasscodeModal = false;
  corePasscode = '';
  corePasscodeError = '';
  corePasscodeSubmitting = false;

  competitorUrls = ['', '', ''];
  competitorResults: ScanResponse[] = [];

  runParentsInfoReport() {
    this.activePanel = 'parents';
    this.runPrimaryScan();
  }

  runCbseComplianceReport() {
    this.activePanel = 'cbse';
    this.runPrimaryScan();
  }

  runSchoolInfoCoreReport() {
    this.activePanel = 'core';
    this.runPrimaryScan();
  }

  openFullReportModal() {
    this.showCorePasscodeModal = true;
    this.corePasscode = '';
    this.corePasscodeError = '';
    this.corePasscodeSubmitting = false;
  }

  closeCorePasscodeModal() {
    this.showCorePasscodeModal = false;
    this.corePasscode = '';
    this.corePasscodeError = '';
    this.corePasscodeSubmitting = false;
  }

  confirmCorePasscode() {
    const pin = (this.corePasscode || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      this.corePasscodeError = 'Enter a valid 6-digit passcode.';
      return;
    }

    this.corePasscodeSubmitting = true;
    this.corePasscodeError = '';
    this.scanService.verifyAdminPin(pin).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.corePasscodeError = 'Invalid or expired passcode.';
          this.corePasscodeSubmitting = false;
          return;
        }
        this.closeCorePasscodeModal();
        this.activePanel = 'core';
        this.runPrimaryScan();
      },
      error: () => {
        this.corePasscodeError = 'Passcode verification failed. Please try again.';
        this.corePasscodeSubmitting = false;
      },
    });
  }

  get schoolDisplayName(): string {
    const explicitName = (this.latestScan?.earlyIdentity?.schoolName || '').trim();
    if (explicitName) return explicitName;

    const rawUrl = this.latestScan?.url || this.primaryUrl;
    if (!rawUrl) return 'School';

    try {
      const host = new URL(this.normalizeInputUrl(rawUrl)).hostname.replace(/^www\./i, '');
      const first = host.split('.')[0] || host;
      return first
        .split(/[-_]+/)
        .map((p) => p ? p.charAt(0).toUpperCase() + p.slice(1) : p)
        .join(' ');
    } catch {
      return 'School';
    }
  }

  get schoolDisplayAddress(): string {
    return (this.latestScan?.earlyIdentity?.address || '').trim();
  }

  gaugeRotation(score: number): number {
    const clamped = Math.max(0, Math.min(100, Number(score) || 0));
    return -90 + (clamped * 180) / 100;
  }

  activateCompetitorPanel() {
    this.activePanel = 'competitors';
    this.error = '';
  }

  runCompetitorComparison() {
    this.activePanel = 'competitors';
    this.error = '';
    const urls = this.competitorUrls.map((u) => u.trim()).filter((u) => !!u);
    if (urls.length !== 3) {
      this.error = 'Please provide exactly 3 school URLs for competitor comparison.';
      return;
    }
    if (!urls.every((u) => this.isValidUrl(u))) {
      this.error = 'One or more competitor URLs are invalid.';
      return;
    }

    this.compareLoading = true;
    this.competitorResults = [];
    const normalizedUrls = urls.map((u) => this.normalizeInputUrl(u));
    this.competitorUrls = [...normalizedUrls];
    const requests = normalizedUrls.map((u) => this.scanToTerminal(u).pipe(
      catchError(() => of({
        sessionId: '',
        url: u,
        status: 'Error' as const,
      } as ScanResponse)),
    ));

    forkJoin(requests).subscribe({
      next: (results) => {
        this.competitorResults = results;
        this.compareLoading = false;
      },
      error: () => {
        this.error = 'Could not complete competitor comparison.';
        this.compareLoading = false;
      },
    });
  }

  readinessChecks(scan: ScanResponse): Array<{ label: string; ok: boolean }> {
    const clarity = scan.clarityScore?.items;
    const safety = scan.safetyScore?.items;
    return [
      { label: 'AEO: Admission + Fee + Contact answers clearly available', ok: !!(clarity?.admissionDatesVisible && clarity?.feeClarity && clarity?.contactAndMap) },
      { label: 'AIO: Policy and compliance disclosures available for AI indexing', ok: !!(safety?.fireCertificate.status === 'found' && safety?.sanitaryCertificate.status === 'found') },
      { label: 'GEO: Trust signals (results + anti-bullying + transport) published', ok: !!(clarity?.resultsPublished && safety?.antiBullyingPolicy.status === 'found' && safety?.transportSafety.status === 'found') },
    ];
  }

  private runPrimaryScan() {
    this.error = '';
    const url = this.primaryUrl.trim();
    if (!url) {
      this.error = 'Please enter a school website URL.';
      return;
    }
    if (!this.isValidUrl(url)) {
      this.error = 'Please enter a valid URL, for example: https://example.com';
      return;
    }

    this.loading = true;
    const normalizedUrl = this.normalizeInputUrl(url);
    const prevUrl = (this.latestScan?.url || '').toLowerCase();
    const isDifferentSchool = !!prevUrl && prevUrl !== normalizedUrl.toLowerCase();
    if (isDifferentSchool) {
      this.latestScan = null;
      this.coreReport = null;
    }
    if (this.activePanel !== 'core') {
      this.coreReport = null;
    }
    this.primaryUrl = normalizedUrl;
    this.scanToTerminal(normalizedUrl).subscribe({
      next: (scan) => {
        this.latestScan = scan;
        if (this.activePanel === 'core' && scan.status === 'Ready') {
          this.coreLoading = true;
          this.scanService.getSchoolInfoCore(scan.sessionId).subscribe({
            next: (core) => {
              this.coreReport = core;
              this.coreLoading = false;
              this.loading = false;
            },
            error: () => {
              this.error = 'Could not generate School Information Core report.';
              this.coreReport = null;
              this.coreLoading = false;
              this.loading = false;
            },
          });
          return;
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Scan failed. Please try again.';
        this.loading = false;
      },
    });
  }

  private scanToTerminal(url: string): Observable<ScanResponse> {
    return this.scanService.submitScan(url).pipe(
      switchMap((start) => this.scanService.pollUntilDone(start.sessionId, 2000, 180).pipe(last())),
    );
  }

  private isValidUrl(url: string): boolean {
    try {
      const u = new URL(this.normalizeInputUrl(url));
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private normalizeInputUrl(url: string): string {
    const value = url.trim();
    if (!value) return value;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  parentCoveragePercent(scan: ScanResponse): number {
    const categories = this.parentQuestionCategories(scan);
    const total = categories.reduce((acc, c) => acc + c.totalQuestions, 0);
    const answered = categories.reduce((acc, c) => acc + c.answeredQuestions, 0);
    const sampleCoverage = total > 0 ? Math.round((answered / total) * 100) : 0;
    const scoreCoverage = scan.overallScore ?? 0;
    return Math.round((sampleCoverage + scoreCoverage) / 2);
  }

  parentQuestionCategories(scan: ScanResponse): ParentCategoryView[] {
    const build = (key: ParentCategoryKey, label: string, rules: ParentQuestionRule[]): ParentCategoryView => {
      const evaluated = rules.map((r) => ({ question: r.question, answered: r.isAnswered(scan) }));
      const answeredQuestions = evaluated.filter((q) => q.answered).length;
      const top3 = [...evaluated]
        .sort((a, b) => Number(a.answered) - Number(b.answered))
        .slice(0, 3);
      return {
        key,
        label,
        totalQuestions: rules.length,
        answeredQuestions,
        items: top3,
      };
    };

    return [
      build('academic', 'Academic Strength & Results', ACADEMIC_RULES),
      build('safety', 'Safety, Trust & Compliance', SAFETY_RULES),
      build('parent', 'Parent Involvement & Communication', PARENT_RULES),
      build('holistic', 'Holistic Growth', HOLISTIC_RULES),
      build('practical', 'Practical Concerns', PRACTICAL_RULES),
    ];
  }

  allDocsMissing(scan: ScanResponse): boolean {
    const docs = scan.mandatoryDocuments || [];
    return docs.length > 0 && docs.every((d) => d.status === 'missing');
  }

  hasUnreachableLinks(scan: ScanResponse): boolean {
    const docs = scan.mandatoryDocuments || [];
    return docs.some((d) => /not reachable/i.test(d.reviewMessage || ''));
  }

  coreStatusLabel(status: 'missing' | 'partial' | 'weak_found' | 'strong_found'): string {
    if (status === 'strong_found') return 'Strong Found';
    if (status === 'weak_found') return 'Weak Found';
    if (status === 'partial') return 'Partial';
    return 'Missing';
  }
}
