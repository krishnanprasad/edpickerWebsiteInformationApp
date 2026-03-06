import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PatternConfig {
  pagePriority: string[];
  phoneLabels: string[];
  principalRoles: string[];
  principalBlockedRoles: string[];
  addressLabels: string[];
  missionHeadings: string[];
  visionHeadings: string[];
}

const DEFAULT_CONFIG: PatternConfig = {
  pagePriority: [
    'home page',
    'contact us',
    'about us',
    'principal message',
    'mandatory public disclosure',
    'footer',
    'admission page',
    'linked pdf documents',
  ],
  phoneLabels: [
    'phone', 'ph', 'tel', 'telephone', 'contact', 'mobile', 'mob', 'call',
    'office', 'reception', 'front office', 'admissions', 'helpdesk',
  ],
  principalRoles: ['principal', 'headmaster', 'headmistress', 'head of school'],
  principalBlockedRoles: ['chairman', 'secretary', 'correspondent', 'founder', 'director', 'trustee', 'dean'],
  addressLabels: ['address', 'location', 'campus', 'school address', 'registered office', 'visit us', 'find us at'],
  missionHeadings: ['mission', 'our mission', 'mission statement', 'vision & mission'],
  visionHeadings: ['vision', 'our vision', 'vision statement', 'vision & mission'],
};

let patternConfig: PatternConfig = { ...DEFAULT_CONFIG };
let loaded = false;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value.trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function extractCodeSpans(md: string): string[] {
  const out: string[] = [];
  const regex = /`([^`]+)`/g;
  let match: RegExpExecArray | null = regex.exec(md);
  while (match) {
    out.push(match[1]);
    match = regex.exec(md);
  }
  return out;
}

function extractNumberedItems(md: string): string[] {
  return md
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, '').trim());
}

function extractSectionBullets(md: string, sectionTitle: string): string[] {
  const lines = md.split('\n');
  const target = sectionTitle.trim().toLowerCase();
  let inSection = false;
  const values: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+/.test(line) || /^#\s+/.test(line)) {
      inSection = line.toLowerCase().includes(target);
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith('## ') || line.startsWith('# ')) break;
    if (line.startsWith('- ')) values.push(line.slice(2).trim());
  }
  return values;
}

async function readPatternFile(fileName: string): Promise<string> {
  const filePath = path.resolve(process.cwd(), 'pattern_identifier', fileName);
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function initPatternConfig(): Promise<void> {
  const [coreMd, phoneMd, principalMd, addressMd, missionMd, visionMd] = await Promise.all([
    readPatternFile('core_parser_rules.md'),
    readPatternFile('phone_number_pattern.md'),
    readPatternFile('principal_pattern.md'),
    readPatternFile('address_pattern.md'),
    readPatternFile('mission_pattern.md'),
    readPatternFile('vision_pattern.md'),
  ]);

  const pagePriority = uniq(extractNumberedItems(coreMd).filter((line) => !line.includes('**')));

  const phoneLabels = uniq(
    extractCodeSpans(phoneMd).filter((v) => /^[a-zA-Z][a-zA-Z\s]{1,40}$/.test(v))
      .concat(DEFAULT_CONFIG.phoneLabels),
  );

  const principalRoles = uniq(
    extractCodeSpans(principalMd)
      .filter((v) => /principal|headmaster|headmistress|head of school/i.test(v))
      .concat(DEFAULT_CONFIG.principalRoles),
  );

  const principalBlockedRoles = uniq(
    extractSectionBullets(principalMd, 'Role Ambiguity Filtering')
      .map((v) => v.replace(/`/g, ''))
      .concat(DEFAULT_CONFIG.principalBlockedRoles),
  );

  const addressLabels = uniq(
    extractCodeSpans(addressMd)
      .filter((v) => /^[a-zA-Z][a-zA-Z\s]{1,50}$/.test(v))
      .concat(DEFAULT_CONFIG.addressLabels),
  );

  const missionHeadings = uniq(
    extractCodeSpans(missionMd)
      .filter((v) => /mission|vision/i.test(v))
      .concat(DEFAULT_CONFIG.missionHeadings),
  );

  const visionHeadings = uniq(
    extractCodeSpans(visionMd)
      .filter((v) => /vision|mission/i.test(v))
      .concat(DEFAULT_CONFIG.visionHeadings),
  );

  patternConfig = {
    pagePriority: pagePriority.length ? pagePriority : DEFAULT_CONFIG.pagePriority,
    phoneLabels: phoneLabels.length ? phoneLabels : DEFAULT_CONFIG.phoneLabels,
    principalRoles: principalRoles.length ? principalRoles : DEFAULT_CONFIG.principalRoles,
    principalBlockedRoles: principalBlockedRoles.length ? principalBlockedRoles : DEFAULT_CONFIG.principalBlockedRoles,
    addressLabels: addressLabels.length ? addressLabels : DEFAULT_CONFIG.addressLabels,
    missionHeadings: missionHeadings.length ? missionHeadings : DEFAULT_CONFIG.missionHeadings,
    visionHeadings: visionHeadings.length ? visionHeadings : DEFAULT_CONFIG.visionHeadings,
  };
  loaded = true;
}

export function getPatternConfig(): PatternConfig {
  return patternConfig;
}

export function isPatternConfigLoaded(): boolean {
  return loaded;
}

