/**
 * Workspace → network members: News & updates (persistent feed) plus optional
 * app push / SMS notify. App path = member inbox + Web Push phone popup.
 */

const store = require('./networkStore');
const notify = require('./networkNotify');
const memberActivity = require('./memberActivity');
const push = require('./pushNotifications');
const memberAppointmentLink = require('./memberAppointmentLink');
const networkNews = require('./networkNews');
const { brandView } = require('./networkBrand');

const MAX_MESSAGE = networkNews.MAX_BODY;
const AUDIENCES = new Set(['all', 'free', 'partner', 'active', 'member']);

function cleanMessage(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MESSAGE);
}

function parseChannels(body = {}) {
  const appOn = body.channelApp === '1' || body.channelApp === 'on' || body.channelApp === true
    || body.notifyApp === '1' || body.notifyApp === 'on' || body.notifyApp === true;
  const smsOn = body.channelSms === '1' || body.channelSms === 'on' || body.channelSms === true
    || body.notifySms === '1' || body.notifySms === 'on' || body.notifySms === true;
  // JSON body may pass channels: { app, sms }
  if (body.channels && typeof body.channels === 'object') {
    return {
      app: !!(body.channels.app ?? appOn),
      sms: !!(body.channels.sms ?? smsOn),
    };
  }
  return { app: !!appOn, sms: !!smsOn };
}

/** @returns {{ audience: string, memberId: string }} */
function parseAudience(raw, body = {}) {
  const a = String(raw || 'all').trim();
  const lower = a.toLowerCase();
  let memberId = String(
    (body && (body.memberId || body.targetMemberId || body.businessId)) || '',
  ).trim();
  // Support audience=member:<id> (and legacy member:id in the select value).
  const prefixed = lower.match(/^member[:|](.+)$/);
  if (prefixed) {
    memberId = String(prefixed[1] || '').trim() || memberId;
    return { audience: 'member', memberId };
  }
  if (AUDIENCES.has(lower)) {
    if (lower !== 'member') memberId = '';
    return { audience: lower, memberId: lower === 'member' ? memberId : '' };
  }
  return { audience: 'all', memberId: '' };
}

function memberMatchesAudience(member, audience, memberId = '') {
  if (!member || member.workspaceStaff) return false;
  if (member.status !== 'active') return false;
  const aud = typeof audience === 'object' && audience
    ? audience
    : parseAudience(audience, { memberId });
  const kind = typeof aud === 'object' ? aud.audience : String(aud || 'all');
  const onlyId = typeof aud === 'object' ? aud.memberId : String(memberId || '').trim();
  if (kind === 'member') {
    return !!onlyId && member.id === onlyId;
  }
  const plan = String(member.plan || '');
  const free = plan === 'app_free' || plan === 'app_flooring';
  if (kind === 'free') return free;
  if (kind === 'partner') return !free;
  // 'all' and 'active' — active non-staff (already filtered)
  return true;
}

async function packageForMember(network, member) {
  const wid = network && network.ownerWorkspaceId;
  if (!wid || !member) return null;
  try {
    return await memberAppointmentLink.findPackageForMember(wid, member, network);
  } catch {
    return null;
  }
}

/**
 * Publish a News & updates post and optionally notify members (app and/or SMS).
 * Always saves to the network feed members can open from Notifications.
 * @returns {{ ok, post?, targeted, appDelivered, smsSent, skipped, notice, error? }}
 */
async function broadcastToMembers({
  network,
  message,
  title: titleIn,
  link,
  linkLabel,
  channels = { app: true, sms: false },
  audience = 'all',
  memberId = '',
  baseUrl,
  subject,
  createdBy,
  saveToFeed = true,
} = {}) {
  if (!network || !network.id) return { ok: false, error: 'Network not found.', targeted: 0 };
  const text = cleanMessage(message);
  if (!text) return { ok: false, error: 'Write a message to send.', targeted: 0 };
  const wantApp = !!(channels && channels.app);
  const wantSms = !!(channels && channels.sms);
  if (!wantApp && !wantSms) {
    return { ok: false, error: 'Choose Notify by app and/or Send SMS.', targeted: 0 };
  }

  const aud = typeof audience === 'object' && audience
    ? parseAudience(audience.audience || audience.kind || 'all', audience)
    : parseAudience(audience, { memberId });
  if (aud.audience === 'member' && !aud.memberId) {
    return { ok: false, error: 'Pick a business to notify.', targeted: 0 };
  }
  const all = await store.listMembers(network.id);
  const targets = all.filter((m) => memberMatchesAudience(m, aud));
  if (!targets.length) {
    return {
      ok: false,
      error: aud.audience === 'member'
        ? 'That business is not an active member.'
        : 'No matching members to message.',
      targeted: 0,
      appDelivered: 0,
      smsSent: 0,
    };
  }

  const brand = brandView(network);
  const title = String(
    titleIn || subject || `Update from ${brand.appName || network.name || 'your network'}`,
  ).trim().slice(0, networkNews.MAX_TITLE) || `Update from ${brand.appName || 'your network'}`;
  const rootBase = String(baseUrl || notify.getReviewPublicBaseUrl() || '').replace(/\/$/, '');
  const safeLink = networkNews.safeLink(link);
  const audienceLabel = aud.audience === 'member' && aud.memberId
    ? `member:${aud.memberId}`
    : aud.audience;

  let post = null;
  if (saveToFeed) {
    post = networkNews.add(network.id, {
      title,
      body: text,
      link: safeLink,
      linkLabel,
      audience: audienceLabel,
      createdBy,
      channels: { app: wantApp, sms: wantSms },
    });
  }

  let appDelivered = 0;
  let smsSent = 0;
  let skipped = 0;

  await Promise.all(targets.map(async (member) => {
    const appHome = notify.memberPortalLink(rootBase, network, member);
    const newsPath = `${appHome}/news${post ? `?id=${encodeURIComponent(post.id)}` : ''}`;
    const openUrl = safeLink || newsPath;
    let memberAppPushes = 0;
    let memberSmsOk = false;

    if (wantApp) {
      memberActivity.add(network.id, member.id, {
        kind: 'news',
        title,
        body: text,
        href: newsPath,
      });
      const pkg = await packageForMember(network, member);
      try {
        const result = await push.sendMemberPush(
          {
            networkId: network.id,
            memberId: member.id,
            packageId: pkg && pkg.id,
            workspaceId: network.ownerWorkspaceId,
          },
          {
            title,
            body: text,
            url: newsPath,
            tag: `member-news-${(post && post.id) || network.id}-${Date.now()}`,
          },
        );
        memberAppPushes = (result && result.sent) || 0;
        appDelivered += memberAppPushes;
      } catch (err) {
        console.warn('[networkBroadcast] push failed:', err && err.message);
      }
    }

    if (wantSms) {
      try {
        const smsBody = `${title}: ${text}${openUrl ? `\n${openUrl}` : ''}`.slice(0, 600);
        const result = await notify.messageMember(network, member, {
          sms: smsBody,
          subject: title,
          email: `${text}\n\n${openUrl ? `Open: ${openUrl}\n\n` : ''}News & updates in your app:\n${newsPath}`,
        });
        if (result && result.ok) {
          memberSmsOk = true;
          smsSent += 1;
        }
      } catch (err) {
        console.warn('[networkBroadcast] sms failed:', err && err.message);
      }
    }

    if (wantApp && !memberAppPushes && wantSms && !memberSmsOk) skipped += 1;
    else if (wantApp && !memberAppPushes && !wantSms) skipped += 1;
    else if (wantSms && !memberSmsOk && !wantApp) skipped += 1;
  }));

  const bits = [];
  bits.push(`Posted news to ${targets.length} member${targets.length === 1 ? '' : 's'}`);
  if (wantApp) bits.push(`${appDelivered} phone alert${appDelivered === 1 ? '' : 's'}`);
  if (wantSms) bits.push(`${smsSent} text${smsSent === 1 ? '' : 's'}`);
  if (post) bits.push('saved under News & updates in the app');

  return {
    ok: true,
    post,
    targeted: targets.length,
    appDelivered,
    smsSent,
    skipped,
    notice: `${bits[0]}${bits.length > 1 ? ` — ${bits.slice(1).join('; ')}` : ''}.`,
  };
}

module.exports = {
  MAX_MESSAGE,
  cleanMessage,
  parseChannels,
  parseAudience,
  memberMatchesAudience,
  broadcastToMembers,
};
