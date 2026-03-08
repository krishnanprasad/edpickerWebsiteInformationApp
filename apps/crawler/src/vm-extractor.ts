import { getPatternConfig } from './pattern-config.js';

export interface ExtractedVMRecord {
  value: string;
  confidence: 'high' | 'medium' | 'low';
  sourceUrl: string;
  sourceType: string;
  sourceSnippet: string;
}

export interface VMResult {
  vision?: ExtractedVMRecord;
  mission?: ExtractedVMRecord;
  motto?: ExtractedVMRecord;
}

export function extractVisionMissionMotto(
  $: any,
  pageUrl: string,
  bodyText: string
): VMResult {
  const lurl = pageUrl.toLowerCase();
  const isDedicatedVmPage = /\b(vision|mission|motto)\b/.test(lurl);
  const patternConfig = getPatternConfig();

  if (/\/(gallery|news|events|admissions?|fees?|page\/\d+)/.test(lurl)) return {};

  const cleanText = (t: string, prefixToRemove: RegExp) => {
    let c = t.replace(prefixToRemove, '').trim();
    c = c.replace(/\s+/g, ' ');
    c = c.replace(/(?:Read More|Know More|Click Here|\.\.\.)$/gi, '').trim();
    if (c.length > 600) {
      const sentences = c.match(/[^.!?]+[.!?]+/g) || [];
      if (sentences.length > 1) c = sentences.slice(0, 2).join(' ').trim();
      else c = `${c.slice(0, 600).trim()}...`;
    }
    if (c.length > 0 && !/[.!?]$/.test(c)) {
      const lastPunc = Math.max(c.lastIndexOf('.'), c.lastIndexOf('!'), c.lastIndexOf('?'));
      if (lastPunc > 0) c = c.slice(0, lastPunc + 1);
    }
    return c;
  };

  const isInvalidText = (t: string) => {
    if (t.length < (isDedicatedVmPage ? 18 : 30)) return true;
    if (!isDedicatedVmPage && !/\b(is|are|to|will|provide|nurture|develop|empower|strive|ensure|commit)\b/i.test(t)) return true;
    if (t.includes('|')) return true;
    if ((t.match(/\n/g) || []).length > 4 && t.length < 200) return true;
    if (/\b(Click|Read More|Know More|Explore|Gallery|Admissions|Apply Now|Register|Admission Open|202[4-9]-2[5-9])\b/i.test(t)) return true;
    return false;
  };

  const isNavHeading = (el: any): boolean => {
    let current = $(el);
    for (let i = 0; i < 4; i++) {
      if (!current.length) break;
      const tn = (current.prop('tagName') || '').toLowerCase();
      if (tn === 'nav' || tn === 'header') return true;
      const cls = current.attr('class') || '';
      const id = current.attr('id') || '';
      if (/(nav|menu|navbar|header|breadcrumb|sidebar)/i.test(`${cls} ${id}`)) return true;
      current = current.parent();
    }
    return false;
  };

  const getHeadingTarget = (headingText: string) => {
    const t = headingText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.length > 40) return null;
    if (patternConfig.visionHeadings.includes(t)) return t.includes('mission') ? 'both' : 'vision';
    if (patternConfig.missionHeadings.includes(t)) return t.includes('vision') ? 'both' : 'mission';
    if (t === 'vision & mission' || t === 'vision and mission' || t === 'mission & vision' || t === 'mission and vision') return 'both';
    if (t === 'motto' || t === 'our motto' || t === 'core values') return 'motto';
    return null;
  };

  const result: VMResult = {};

  const processText = (text: string, targetType: string, confidence: 'high' | 'medium' | 'low', snippet: string) => {
    if (targetType === 'both') {
      const vMatch = text.match(/(?:vision)[:\-\s]+(.*?)(?:mission|$)/i);
      const mMatch = text.match(/(?:mission)[:\-\s]+(.*?)$/i);
      if (vMatch && vMatch[1]) processText(vMatch[1], 'vision', confidence, snippet);
      if (mMatch && mMatch[1]) processText(mMatch[1], 'mission', confidence, snippet);
      return;
    }

    const prefix = /(?:our\s+)?(vision|mission|motto)\s*(?:statement)?\s*[:\-–]?\s*/i;
    const cleaned = cleanText(text, prefix);
    if (!isInvalidText(cleaned) && !result[targetType as keyof VMResult]) {
      result[targetType as keyof VMResult] = {
        value: cleaned,
        confidence,
        sourceUrl: pageUrl,
        sourceType: 'html',
        sourceSnippet: snippet.slice(0, 200),
      };
    }
  };

  $('h1, h2, h3, h4').each((_: any, el: any) => {
    if (isNavHeading(el)) return;
    const targetType = getHeadingTarget($(el).text());
    if (!targetType) return;

    let sibling = $(el).next();
    let attempts = 0;
    while (sibling.length && attempts < 5) {
      const tn = (sibling.prop('tagName') || '').toLowerCase();
      if (['p', 'div', 'span', 'blockquote', 'section'].includes(tn)) {
        const text = sibling.text().replace(/\s+/g, ' ').trim();
        processText(text, targetType, 'high', text);
      }
      sibling = sibling.next();
      attempts++;
    }
  });

  if (!result.vision || !result.mission || !result.motto) {
    $('div, p, section').each((_: any, el: any) => {
      if (isNavHeading(el)) return;
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length < 20 || text.length > 2000) return;

      if (!result.vision && /\b(?:our\s+)?vision\b/i.test(text)) {
        const m = text.match(/(?:our\s+)?vision\s*(?:statement)?\s*[:\-–]?\s*(.*?)(?:\n|our\s+mission|our\s+motto|$)/i);
        if (m && m[1]) processText(m[1], 'vision', 'medium', text);
      }
      if (!result.mission && /\b(?:our\s+)?mission\b/i.test(text)) {
        const m = text.match(/(?:our\s+)?mission\s*(?:statement)?\s*[:\-–]?\s*(.*?)(?:\n|our\s+vision|our\s+motto|$)/i);
        if (m && m[1]) processText(m[1], 'mission', 'medium', text);
      }
      if (!result.motto && /\b(?:our\s+)?motto\b/i.test(text)) {
        const m = text.match(/(?:our\s+)?motto\s*[:\-–]?\s*(.*?)(?:\n|our\s+vision|$)/i);
        if (m && m[1]) processText(m[1], 'motto', 'medium', text);
      }
    });
  }

  if (isDedicatedVmPage && (!result.vision || !result.mission)) {
    $('main p, article p, section p, .entry-content p, .content p, p').each((_: any, el: any) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length < 20 || text.length > 500) return;
      if (!result.vision && /\bvision\b/i.test(text)) processText(text, 'vision', 'high', text);
      if (!result.mission && /\bmission\b/i.test(text)) processText(text, 'mission', 'high', text);
    });
  }

  if (!result.vision) {
    const metaVs = $('meta[name="description"]').attr('content') || '';
    if (metaVs && /\bvision\b/i.test(metaVs)) {
      const m = metaVs.match(/(?:vision)\s*[:\-–]?\s*(.*)/i);
      if (m && m[1]) processText(m[1], 'vision', 'low', metaVs);
    }
  }

  return result;
}
