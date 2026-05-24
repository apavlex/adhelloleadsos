const express = require('express');
const router = express.Router();
const { chatCompletion } = require('../services/llmClient');

/**
 * GET /newsletter — Newsletter dashboard page for Presso Coffee Co.
 */
router.get('/', async (req, res) => {
  res.render('newsletter', {
    user: req.user,
    activePage: 'ceo',
  });
});

/**
 * POST /newsletter/generate — AI generates a weekly Presso newsletter draft.
 *
 * Takes optional overrides: weekOf, sponsorName, sponsorOffer, promoText, founderNote
 * Returns structured newsletter with sections.
 */
router.post('/generate', express.json(), async (req, res) => {
  try {
    const {
      weekOf,
      sponsorName,
      sponsorOffer,
      promoText,
      founderNote,
      customInstructions,
    } = req.body || {};

    const today = new Date();
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));

    const week = weekOf || nextMonday.toISOString().split('T')[0];
    const weekEnd = new Date(new Date(week).getTime() + 6 * 86400000).toISOString().split('T')[0];

    const prompt = `Generate a weekly newsletter for **Presso Coffee Co.** — a local coffee shop in Camas, WA (Portland metro area).

**TARGET AUDIENCE:** 5,000 loyalty rewards members — locals in Camas/Vancouver, WA area. They visit the shop regularly.

**NEWSLETTER DETAILS:**
- Week: ${week} to ${weekEnd}
- The newsletter goes out every Friday or Monday
${sponsorName ? `- FEATURED SPONSOR: ${sponsorName} — Offer: ${sponsorOffer || 'TBD'}` : '- SPONSOR SLOT: Available this week (no sponsor yet)'}
${promoText ? `- THIS WEEK'S PROMO: ${promoText}` : '- PROMO: Create a suggestion for a weekly promotion'}
${founderNote ? `- FOUNDER'S NOTE TOPIC: ${founderNote}` : '- FOUNDER\'S NOTE: Write a short personal note from Alex, the owner'}
${customInstructions ? `- SPECIAL INSTRUCTIONS: ${customInstructions}` : ''}

**WHAT TO INCLUDE (structure as sections):**
1. **☕ From the Roaster** — Shop update or seasonal drink spotlight. What's new at Presso this week.
2. **🎁 Rewards Corner** — Highlight a loyalty perk, point milestone, or upcoming reward expiration. Make members feel valued.
3. **📅 This Week in Camas/Vancouver** — 3-4 local events happening that week. Think farmers markets, live music (check common venues like the Liberty Theatre, Downtown Camas, Lacamas Lake events, First Friday, etc.), school events, seasonal festivals, outdoor activities. Include dates and brief details.
4. **🏘️ Around Town** — 1-2 local business or community spotlights. New restaurant opening, cool shop, community project, etc.
5. ${sponsorName ? `**🤝 Sponsored by ${sponsorName}** — ${sponsorOffer || 'Write a compelling sponsored section based on this local business'}` : '**🤝 Sponsor This Space** — Brief, friendly pitch for local businesses to sponsor the newsletter (5K+ locals, $X/wk, email alex@adhello.ai)'}
6. **💬 From Alex** — Short personal founder's note. Warm, conversational, Camas-local voice.${founderNote ? ` Topic: "${founderNote}"` : ''}

**VOICE & TONE:**
- Warm, local, community-first. Like a neighbor telling you what's happening.
- Casual but not sloppy. "Hey Camas!" energy.
- Keep each section 3-5 sentences max. Total newsletter: 400-600 words.
- Use emoji as section markers (already in the structure above).
- No corporate speak. No buzzwords. Real talk.

**FORMAT THE OUTPUT** in clean sections with markdown headers (## for section titles). Put the subject line at the very top prefixed with **Subject:**
End with a footer:
---
*Presso Coffee Co. • Downtown Camas, WA*
*You're getting this because you're a loyalty member. Unsubscribe anytime.*`;

    const { content, error } = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.8,
    });

    if (error || !content) {
      throw new Error(error || 'AI generation failed');
    }

    // Extract subject line from the AI output
    const subjectMatch = content.match(/(?:\*\*)?Subject:(?:\*\*)?\s*(.+?)(?:\n|$)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : `Presso Weekly — ${new Date(week).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;

    // Parse sections
    const sections = parseSections(content);

    res.json({
      success: true,
      newsletter: {
        week,
        weekEnd,
        subject,
        rawContent: content,
        sections,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[NEWSLETTER] Generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /newsletter/export-html — Convert newsletter content to GHL-compatible HTML email.
 */
router.post('/export-html', express.json(), async (req, res) => {
  try {
    const { subject, sections, sponsorName } = req.body || {};

    if (!sections || !sections.length) {
      return res.status(400).json({ success: false, error: 'No sections provided.' });
    }

    const html = buildNewsletterHTML(subject, sections, sponsorName);
    res.json({ success: true, html });
  } catch (err) {
    console.error('[NEWSLETTER] Export error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────────

function parseSections(rawContent) {
  // Remove the Subject line from the body
  let body = rawContent.replace(/^(?:\*\*)?Subject:(?:\*\*)?\s*.+(?:\n|$)/im, '').trim();

  // Split by ## headers
  const sectionRegex = /^## (.+)$/gm;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = sectionRegex.exec(body)) !== null) {
    if (lastIndex > 0) {
      parts.push({
        title: parts[parts.length - 1]?.title || '',
        content: body.slice(lastIndex, match.index).trim(),
      });
    }
    lastIndex = match.index;
  }
  // Get the first part before any ##
  if (body.indexOf('##') > 0) {
    const intro = body.slice(0, body.indexOf('##')).trim();
    if (intro) {
      parts.push({ title: 'Intro', content: intro });
    }
  }

  // Parse sections properly
  const finalSections = [];
  const lines = body.split('\n');
  let currentTitle = '';
  let currentContent = [];

  for (const line of lines) {
    const hMatch = line.match(/^## (.+)/);
    if (hMatch) {
      if (currentTitle || currentContent.length) {
        finalSections.push({
          title: currentTitle || 'Intro',
          content: currentContent.join('\n').trim(),
        });
      }
      currentTitle = hMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentTitle || currentContent.length) {
    finalSections.push({
      title: currentTitle || 'Intro',
      content: currentContent.join('\n').trim(),
    });
  }

  return finalSections.length ? finalSections : [{ title: 'Newsletter', content: body }];
}

function buildNewsletterHTML(subject, sections, sponsorName) {
  const logoUrl = 'https://pressocoffee.co/logo.png'; // placeholder

  const sectionColors = {
    '☕ From the Roaster': '#3E2723',
    '🎁 Rewards Corner': '#6D4C41',
    '📅 This Week': '#8D6E63',
    '🏘️ Around Town': '#A1887F',
    '🤝': '#5D4037',
    '💬 From Alex': '#4E342E',
  };

  const sectionsHTML = sections.map((s) => {
    // Format content: convert **bold**, newlines to <br>
    let html = s.content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li style="margin-bottom:4px">$1</li>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');

    // Wrap list items
    html = html.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, '<ul style="padding-left:20px;margin:8px 0">$1</ul>');

    const accentColor = Object.entries(sectionColors).find(([k]) => s.title.includes(k))?.[1] || '#5D4037';

    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
        <tr>
          <td style="padding-bottom:10px;border-bottom:2px solid ${accentColor}">
            <h3 style="font-family:'Georgia',serif;font-size:20px;color:${accentColor};margin:0;font-weight:bold">${s.title}</h3>
          </td>
        </tr>
        <tr>
          <td style="padding-top:12px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:#333333">
            ${html}
          </td>
        </tr>
      </table>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F0EB">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EB">
    <tr><td align="center" style="padding:20px 0">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px">

        <!-- Header -->
        <tr>
          <td style="background:#3E2723;padding:32px 30px;text-align:center;border-radius:8px 8px 0 0">
            <h1 style="font-family:'Georgia',serif;font-size:28px;color:#D7CCC8;margin:0;letter-spacing:1px">Presso Coffee Co.</h1>
            <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#A1887F;margin:6px 0 0">Downtown Camas, WA — Weekly Brew</p>
          </td>
        </tr>

        <!-- Date + Subject -->
        <tr>
          <td style="background:#4E342E;padding:16px 30px;border-radius:0 0 8px 8px">
            <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#BCAAA4;margin:0;text-transform:uppercase;letter-spacing:2px">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <h2 style="font-family:'Georgia',serif;font-size:22px;color:#FFFFFF;margin:6px 0 0;font-weight:bold">${subject}</h2>
          </td>
        </tr>

        <!-- Content -->
        <tr>
          <td style="background:#FFFFFF;padding:30px;border-radius:0 0 8px 8px">
            ${sectionsHTML}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 30px;text-align:center">
            <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#8D6E63;margin:0">
              <strong>Presso Coffee Co.</strong> • Downtown Camas, WA<br>
              You're receiving this as a loyalty rewards member.<br>
              <a href="#" style="color:#5D4037">Unsubscribe</a> anytime.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = router;