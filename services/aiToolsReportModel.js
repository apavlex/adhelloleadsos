const { normalizeAssessment } = require('./aiToolsAssessment');

function slugifyFilename(name) {
  return String(name || 'business')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'business';
}

/**
 * View model for ai_tools_report.ejs — merges persisted assessment with lead metadata.
 */
function buildAiToolsReportViewModel(lead, assessmentOverride, opts) {
  opts = opts || {};
  const leadRecord = lead || {};
  const stored =
    assessmentOverride ||
    (leadRecord.aiToolsAssessment && typeof leadRecord.aiToolsAssessment === 'object'
      ? leadRecord.aiToolsAssessment
      : null);

  const vm = normalizeAssessment(stored, leadRecord);

  if (!vm.clientName) vm.clientName = String(leadRecord.title || 'Your business').trim();
  if (!vm.businessType) {
    const cat = String(leadRecord.categoryName || leadRecord.category || 'Local business').trim();
    const city = [leadRecord.city, leadRecord.state].filter(Boolean).join(', ');
    vm.businessType = city ? `${cat} · ${city}` : cat;
  }

  const bookUrl = String(process.env.ADHELLO_BOOK_URL || 'https://adhello.ai/book').trim();
  const salesPhone = String(process.env.ADHELLO_SALES_PHONE || '').trim();
  const company = vm.clientName || 'your team';

  return {
    ...vm,
    businessName: vm.clientName,
    website: String(leadRecord.website || '').trim(),
    phone: String(leadRecord.phone || '').trim(),
    address: String(leadRecord.address || '').trim(),
    bookUrl,
    salesPhone,
    pdfFilename: `${slugifyFilename(vm.clientName)}-ai-tools-assessment.pdf`,
    followUpEmail: {
      subject: `Your AI Tools Assessment — ${vm.clientName}`,
      body: `Hi ${company},\n\nAs discussed, here is your personalized AI Tools Assessment:\n\n${opts.reportUrl || '[link]'}\n\nThe quick wins on pages 4–6 are the fastest place to start. Reply with any questions or book a review call here: ${bookUrl}\n\nBest,\n`,
    },
    smsSnippet: opts.reportUrl
      ? `Here's your AI Tools Assessment for ${vm.clientName}: ${opts.reportUrl}`
      : '',
  };
}

module.exports = {
  buildAiToolsReportViewModel,
};
