/**
 * Runtime sender sign-off placeholders for scripts.
 * [Name] is the prospect — never filled from the sender profile.
 */

const { htmlToPlain } = require('./scriptMarkup');

const EMPTY_MARK = '\u0000';

const SENDER_GROUPS = [
  {
    key: 'name',
    aliases: ['your name', 'sender name'],
  },
  {
    key: 'company',
    aliases: [
      'company name',
      'your company',
      'agency name',
      'business name',
      'your agency',
      'your company name',
    ],
  },
  {
    key: 'phone',
    aliases: ['phone number', 'your phone', 'your number', 'phone'],
  },
  {
    key: 'email',
    aliases: ['email address', 'your email', 'email'],
  },
];

const SHORT_COMPANY_ALIASES = ['agency', 'company'];

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function userDisplayName(user) {
  return firstNonEmpty(user && user.displayName);
}

function userEmailAddress(user) {
  const emails = user && Array.isArray(user.emails) ? user.emails : [];
  const fromList = emails[0] && emails[0].value;
  return firstNonEmpty(fromList, user && user.email);
}

function brandKitOf(ws) {
  return ws && ws.brandKit && typeof ws.brandKit === 'object' ? ws.brandKit : {};
}

function salesIntakeOf(ws) {
  return ws && ws.salesIntake && typeof ws.salesIntake === 'object' ? ws.salesIntake : {};
}

function telephonyCallerNumber(ws) {
  const telephony = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entries = Array.isArray(telephony.numberBankEntries) ? telephony.numberBankEntries : [];
  const fromEntries = entries.map((e) => String((e && e.number) || '').trim()).filter(Boolean);
  const fromLegacy = Array.isArray(telephony.numberBank)
    ? telephony.numberBank.map((n) => String(n || '').trim()).filter(Boolean)
    : [];
  const bank = [...fromEntries, ...fromLegacy];
  const active = String(telephony.activeFromNumber || '').trim();
  if (active && bank.includes(active)) return active;
  return firstNonEmpty(active, bank[0], telephony.agentPhone);
}

function catalogEntry(ws, offerKey) {
  const key = String(offerKey || '').trim();
  const catalog = ws && Array.isArray(ws.salesScriptOfferCatalog) ? ws.salesScriptOfferCatalog : [];
  if (key) {
    const hit = catalog.find((row) => row && String(row.key) === key);
    if (hit) return hit;
  }
  return catalog[0] || null;
}

/**
 * @param {{ user?: object, workspace?: object, offerKey?: string, offer?: object }} opts
 * @returns {{ name: string, company: string, phone: string, email: string }}
 */
function resolveScriptSignOffProfile(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const user = o.user || null;
  const ws = o.workspace && typeof o.workspace === 'object' ? o.workspace : {};
  const brand = brandKitOf(ws);
  const intake = salesIntakeOf(ws);
  const offer = o.offer && typeof o.offer === 'object' ? o.offer : catalogEntry(ws, o.offerKey);

  const name = userDisplayName(user);
  const company = firstNonEmpty(
    offer && offer.senderBusinessName,
    brand.businessName,
    intake.businessName,
    ws.name,
  );
  const phone = firstNonEmpty(brand.phone, telephonyCallerNumber(ws));
  const email = firstNonEmpty(brand.email, userEmailAddress(user));

  return { name, company, phone, email };
}

function aliasPattern(aliases) {
  const inner = aliases
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((a) => a.replace(/\s+/g, '\\s+'))
    .join('|');
  return new RegExp(`\\[(?:${inner})\\]`, 'gi');
}

function lineIsOnlyPlaceholder(line, regex) {
  const stripped = String(line || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  if (!stripped) return false;
  const copy = regex;
  copy.lastIndex = 0;
  const m = copy.exec(stripped);
  if (!m) return false;
  return stripped.replace(m[0], '').trim() === '';
}

function replaceWithValue(text, regex, value) {
  const v = String(value || '').trim();
  if (!v) return String(text || '');
  return String(text || '').replace(regex, v);
}

function cleanupEmptyMarks(text) {
  let s = String(text || '');
  s = s
    .split('\n')
    .filter((line) => {
      const stripped = String(line)
        .replace(/<br\s*\/?>/gi, '')
        .replace(new RegExp(EMPTY_MARK, 'g'), '')
        .trim();
      const wasPlaceholderLine = String(line).includes(EMPTY_MARK) && !stripped;
      return !wasPlaceholderLine;
    })
    .join('\n');
  s = s.replace(new RegExp(EMPTY_MARK, 'g'), '');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/[ \t]+\n/g, '\n');
  return s.replace(/\n{3,}/g, '\n\n');
}

function replaceSenderPlaceholders(text, profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  let s = String(text || '');
  if (!s) return '';

  for (const group of SENDER_GROUPS) {
    const re = aliasPattern(group.aliases);
    const value = p[group.key] || '';
    const lines = s.split('\n');
    s = lines
      .map((line) => {
        if (!String(value || '').trim() && lineIsOnlyPlaceholder(line, aliasPattern(group.aliases))) {
          return EMPTY_MARK;
        }
        return replaceWithValue(line, re, value);
      })
      .join('\n');
  }

  for (const alias of SHORT_COMPANY_ALIASES) {
    const re = aliasPattern([alias]);
    const value = p.company || '';
    const lines = s.split('\n');
    s = lines
      .map((line) => {
        if (!String(value || '').trim() && lineIsOnlyPlaceholder(line, aliasPattern([alias]))) {
          return EMPTY_MARK;
        }
        return replaceWithValue(line, re, value);
      })
      .join('\n');
  }

  return cleanupEmptyMarks(s);
}

function replaceProspectPlaceholders(text, prospect) {
  const pr = prospect && typeof prospect === 'object' ? prospect : {};
  const name = firstNonEmpty(pr.name, pr.contact, pr.owner);
  const company = firstNonEmpty(pr.company, pr.title, pr.business);
  const city = firstNonEmpty(pr.city);
  let s = String(text || '');
  if (name) {
    s = s.replace(/\{\{\s*name\s*\}\}/gi, name);
    s = s.replace(/\[name\]/gi, name);
  }
  if (company) {
    s = s.replace(/\{\{\s*company\s*\}\}/gi, company);
    s = s.replace(/\{\{\s*business_name\s*\}\}/gi, company);
  }
  if (city) {
    s = s.replace(/\{\{\s*city\s*\}\}/gi, city);
  }
  return s;
}

function fillScriptPlaceholders(text, { sender, prospect } = {}) {
  let s = replaceSenderPlaceholders(text, sender);
  s = replaceProspectPlaceholders(s, prospect);
  return s;
}

function applySenderPlaceholdersDeep(value, profile) {
  if (typeof value === 'string') return replaceSenderPlaceholders(value, profile);
  if (Array.isArray(value)) return value.map((v) => applySenderPlaceholdersDeep(v, profile));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = applySenderPlaceholdersDeep(value[k], profile);
    }
    return out;
  }
  return value;
}

function fillScriptPlain(text, ctx) {
  return htmlToPlain(fillScriptPlaceholders(text, ctx));
}

module.exports = {
  resolveScriptSignOffProfile,
  replaceSenderPlaceholders,
  replaceProspectPlaceholders,
  fillScriptPlaceholders,
  applySenderPlaceholdersDeep,
  fillScriptPlain,
};
