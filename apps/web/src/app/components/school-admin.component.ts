import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, last, Observable, of, switchMap } from 'rxjs';
import { ScanResponse } from '../models/scan.models';
import { ScanService } from '../services/scan.service';

type AdminPanel = 'parents' | 'cbse' | 'competitors';
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
          <button class="btn btn-cbse" [class.btn-loading]="loading && activePanel === 'cbse'" (click)="runCbseComplianceReport()" [disabled]="loading">
            <span class="btn-inner" [style.opacity]="loading && activePanel === 'cbse' ? 0 : 1">2. CBSE Compliance Report</span>
            <span class="five-dots" *ngIf="loading && activePanel === 'cbse'" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
          <button class="btn btn-compare" (click)="activateCompetitorPanel()">
            3. Competitor Comparison
          </button>
        </div>

        <p class="error" *ngIf="error">{{ error }}</p>
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
    </main>
  `,
  styles: [`
    .admin-shell { max-width: 1120px; margin: 0 auto; padding: 20px; color: #13293d; }
    .admin-header h1 { margin: 0; font-size: 32px; }
    .admin-header p { margin: 8px 0 0; color: #415a77; }
    .input-card, .panel { background: #fff; border: 1px solid #d8e2ec; border-radius: 14px; padding: 16px; margin-top: 14px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #b9c9d8; border-radius: 10px; padding: 10px 12px; font-size: 14px; }
    .btn-row { margin-top: 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .btn { border: 0; border-radius: 10px; padding: 10px 12px; font-weight: 700; color: #fff; cursor: pointer; position: relative; min-height: 40px; }
    .btn:disabled { opacity: 0.7; cursor: not-allowed; }
    .btn-loading { box-shadow: 0 0 0 1.5px rgba(255,255,255,0.5) inset; }
    .btn-inner { transition: opacity 0.15s; }
    .btn-parents { background: #0f766e; }
    .btn-cbse { background: #1d4ed8; }
    .btn-compare { background: #b45309; margin-top: 12px; }
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
    @media (max-width: 900px) {
      .btn-row { grid-template-columns: 1fr; }
      .score-grid { grid-template-columns: 1fr; }
      .question-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class SchoolAdminComponent {
  private readonly scanService = inject(ScanService);

  primaryUrl = '';
  activePanel: AdminPanel = 'parents';
  loading = false;
  compareLoading = false;
  error = '';
  latestScan: ScanResponse | null = null;

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
    this.primaryUrl = normalizedUrl;
    this.scanToTerminal(normalizedUrl).subscribe({
      next: (scan) => {
        this.latestScan = scan;
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
}
