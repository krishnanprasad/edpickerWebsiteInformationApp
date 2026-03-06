export interface NormalizedUrlResult {
  original: string;
  normalized: string;
  wasGoogleAd: boolean;
  hadTrackingParams: boolean;
  hadDeepLink: boolean;
  error?: string;
}

const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com', 'linkedin.com'];
const MAP_DOMAINS = ['maps.google.com', 'goo.gl'];
const DIRECTORY_DOMAINS = ['google.com', 'wikipedia.org', 'justdial.com', 'schoolmykids.com', 'sulekha.com'];

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 
  'utm_content', 'fbclid', 'gclid', 'gclsrc', 'ref', 'source',
  'campaign', 'mc_cid', 'mc_eid', '_ga', 'msclkid'
];

export function normalizeSchoolUrl(rawInput: string): NormalizedUrlResult {
  const original = rawInput.trim();
  const result: NormalizedUrlResult = {
    original,
    normalized: '',
    wasGoogleAd: false,
    hadTrackingParams: false,
    hadDeepLink: false
  };

  // 1. Not a URL check (very basic: lacks period or contains spaces that aren't encoded)
  if (!original.includes('.') || original.includes(' ')) {
    result.error = "Please paste a valid website URL (we'll support name search soon).";
    return result;
  }

  let workUrl = original;
  if (!/^https?:\/\//i.test(workUrl)) {
    workUrl = 'https://' + workUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(workUrl);
  } catch {
    result.error = "We couldn't read this URL. Try pasting just the school website address.";
    return result;
  }

  // Check social
  if (SOCIAL_DOMAINS.some(d => parsed.hostname.toLowerCase().endsWith(d))) {
    result.error = "This looks like a social media link. Please paste the school's own website URL.";
    return result;
  }

  // Check Google Maps
  if (MAP_DOMAINS.some(d => parsed.hostname.toLowerCase().endsWith(d)) || 
      (parsed.hostname.toLowerCase().endsWith('google.com') && parsed.pathname.startsWith('/maps'))) {
    result.error = "This is a Google Maps link. Please paste the school's website URL instead.";
    return result;
  }

  // 2. Google Ads redirect
  if (parsed.hostname.toLowerCase().includes('googleadservices.com') || 
      parsed.hostname.toLowerCase().includes('googlesyndication.com')) {
    const adurl = parsed.searchParams.get('adurl');
    if (adurl) {
      result.wasGoogleAd = true;
      try {
        let decodedAdUrl = adurl;
        if (!/^https?:\/\//i.test(decodedAdUrl)) {
            decodedAdUrl = 'https://' + decodedAdUrl;
        }
        parsed = new URL(decodedAdUrl);
      } catch {
        result.error = "We couldn't extract the actual URL from this ad link. Please paste the school's own website URL.";
        return result;
      }
    }
  }

  // 6. Strip tracking params
  const paramKeys = Array.from(parsed.searchParams.keys());
  for (const key of paramKeys) {
    if (TRACKING_PARAMS.includes(key.toLowerCase())) {
      parsed.searchParams.delete(key);
      result.hadTrackingParams = true;
    }
  }

  // 7. Discard pathname entirely if there is one
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    result.hadDeepLink = true;
    parsed.pathname = '/';
  }
  
  // Also check if any params left, sometimes deep links rely on query string like index.php?page=admission
  // The spec says "Strip everything after the root domain", which usually implies query string and hash as well.
  if (Array.from(parsed.searchParams.keys()).length > 0 && !result.hadTrackingParams) {
      // If we didn't just strip tracking params, but there are still params, it's likely a deep link like index.php?page=...
      // Or if there are ANY params left, we discard them.
      result.hadDeepLink = true;
      parsed.search = '';
  }
  parsed.search = ''; // Strip all query params per "Strip everything after the root domain"
  parsed.hash = '';

  // 4 & 5. Lowercase hostname and remove www.
  let cleanHost = parsed.hostname.toLowerCase();
  if (cleanHost.startsWith('www.')) {
    cleanHost = cleanHost.substring(4);
  }

  // 8. Force protocol to https
  // 9. Remove trailing slash by just using the host
  // 10. Return clean domain string only e.g. "psgschool.ac.in"
  result.normalized = cleanHost;

  // 4. IP / localhost / no dot validation
  if (!cleanHost.includes('.') || cleanHost === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(cleanHost)) {
    result.error = "We couldn't read this URL. Try pasting just the school website address.";
    return result;
  }

  // 5. Check directory
  if (DIRECTORY_DOMAINS.some(d => cleanHost.endsWith(d))) {
    result.error = "This looks like a directory or search result. Please paste the school's own website URL.";
    return result;
  }

  return result;
}
