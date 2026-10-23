/**
 * Appointment tracker + marketplace tools for MCP clients and in-app Alex:
 * list packages, create packages, deliver leads, browse/buy pool slots.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const appointmentPackages = require('../appointmentPackages');
const appointmentPool = require('../appointmentPool');
const notify = require('../networkNotify');

function toolError(message, code = 'APPOINTMENTS_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function pageUrl(ctx) {
  const base = (ctx && ctx.baseUrl) || notify.baseUrlFromReq(null) || '';
  return `${String(base).replace(/\/+$/, '')}/appointments`;
}

async function requireDeliverAccess(ctx) {
  if (ctx && ctx.canManage === true) return;
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  const role = workspaceService.roleForEmail(ws, ctx.userEmail || '');
  if (!workspaceService.canManageTeam(role)) {
    throw toolError('Only workspace owners and admins can push leads to appointment packages.', 'FORBIDDEN');
  }
}

function presentPackage(pkg) {
  if (!pkg) return null;
  const credits = pkg.leadCredits || {};
  return {
    id: pkg.id,
    business_name: pkg.businessName || 'Contractor',
    trade: pkg.trade || '',
    purchased: pkg.purchased || 0,
    booked: pkg.booked || 0,
    closed: pkg.closed || 0,
    open_form_leads: pkg.openFormLeads || 0,
    leads_purchased: credits.purchased || 0,
    leads_delivered: credits.delivered || 0,
    booking_url: pkg.bookingUrl || null,
    ghl_calendar_id: pkg.ghlCalendarId || null,
    status: pkg.status || null,
    notes: pkg.notes || '',
  };
}

function presentListing(listing) {
  if (!listing) return null;
  return {
    id: listing.id,
    title: listing.title || 'Appointment package',
    trade: listing.trade || '',
    slots_left: listing.slotsLeft || 0,
    slots_total: listing.slotsTotal || 0,
    price_per_slot: listing.pricePerSlot || null,
    commission_note: listing.commissionNote || '',
    note: listing.note || '',
    status: listing.status || '',
  };
}

async function listAppointmentPackages(ctx) {
  const view = await appointmentPackages.loadTodayView(ctx.workspaceId);
  const packages = (view.packages || []).map(presentPackage);
  return {
    count: packages.length,
    packages,
    totals: view.totals || null,
    overall_pct: view.overallPct || 0,
    trades: view.trades || [],
    last_sync_at: view.lastSyncAt || null,
    ghl_configured: !!view.ghlConfigured,
    appointments_page: pageUrl(ctx),
  };
}

async function createAppointmentPackage(ctx, input) {
  await requireDeliverAccess(ctx);
  const pkg = await appointmentPackages.createPackage(ctx.workspaceId, {
    businessName: input.business_name,
    trade: input.trade,
    purchased: input.purchased,
    leadsPurchased: input.leads_purchased != null ? input.leads_purchased : input.purchased,
    contactEmail: input.contact_email,
    contactPhone: input.contact_phone,
    bookingUrl: input.booking_url,
    websiteUrl: input.website_url,
    ghlCalendarId: input.ghl_calendar_id,
    ghlCalendarName: input.ghl_calendar_name,
    formMatchTag: input.form_match_tag,
    notes: input.notes,
    leadKey: input.lead_id,
  });
  return {
    message: `Created appointment package for ${pkg.businessName || 'contractor'}.`,
    package: presentPackage({ ...pkg, openFormLeads: 0, booked: 0, closed: 0 }),
    appointments_page: pageUrl(ctx),
  };
}

async function deliverAppointmentLead(ctx, input) {
  await requireDeliverAccess(ctx);
  const leadInput = {
    name: input.name,
    phone: input.phone,
    email: input.email,
    note: input.note || input.notes,
    city: input.city,
    zip: input.zip,
    address: input.address,
    leadKey: input.lead_id,
  };

  if (input.package_id) {
    const result = await appointmentPackages.deliverLeadToPackage(
      ctx.workspaceId,
      input.package_id,
      leadInput,
    );
    if (!result || !result.matched) {
      throw toolError('Appointment package not found or lead was not delivered.', 'DELIVER_FAILED');
    }
    return {
      message: result.isNew
        ? 'Lead delivered to the appointment package.'
        : 'That package already had this lead — updated the existing entry.',
      package_id: input.package_id,
      is_new: !!result.isNew,
      appointments_page: pageUrl(ctx),
    };
  }

  const bulk = await appointmentPackages.deliverLeadBulk(ctx.workspaceId, {
    packageIds: input.package_ids,
    trade: input.trade,
    leadInput,
  });
  if (bulk && bulk.ok === false) {
    throw toolError(bulk.error || 'Could not deliver that lead.', 'DELIVER_FAILED');
  }
  return {
    message: `Lead delivered to ${((bulk && bulk.delivered) || []).length || 0} package(s).`,
    result: bulk,
    appointments_page: pageUrl(ctx),
  };
}

async function listAppointmentMarketplace(ctx, input) {
  const all = input.include_sold_out ? appointmentPool.listAll() : appointmentPool.listAvailable();
  const trade = String(input.trade || '')
    .trim()
    .toLowerCase();
  const listings = all
    .filter((l) => !trade || String(l.trade || '').toLowerCase() === trade)
    .slice(0, Math.min(100, input.limit || 40))
    .map(presentListing);
  const summary = appointmentPool.poolSummary();
  const purchases = appointmentPool.purchasesForWorkspace(ctx.workspaceId);
  return {
    count: listings.length,
    listings,
    marketplace: {
      available_count: summary.availableCount,
      slots_left: summary.slotsLeft,
    },
    my_purchases: purchases.slice(0, 20).map((p) => ({
      id: p.id,
      listing_id: p.listingId,
      package_id: p.packageId,
      quantity: p.quantity,
      trade: p.trade,
      title: p.title,
      created_at: p.createdAt,
    })),
    appointments_page: pageUrl(ctx),
  };
}

async function buyAppointmentSlots(ctx, input) {
  await requireDeliverAccess(ctx);
  const result = await appointmentPool.buyListing(input.listing_id, ctx.workspaceId, {
    quantity: input.quantity,
    by: ctx.userEmail || 'AI assistant',
  });
  if (!result || !result.ok) {
    throw toolError((result && result.error) || 'Purchase failed.', 'BUY_FAILED');
  }
  return {
    message: `Bought ${result.purchase.quantity} appointment slot(s) — package created.`,
    purchase: {
      id: result.purchase.id,
      quantity: result.purchase.quantity,
      listing_id: result.purchase.listingId,
      package_id: result.purchase.packageId,
    },
    package: presentPackage({
      ...result.package,
      openFormLeads: 0,
      booked: 0,
      closed: 0,
    }),
    listing: presentListing(result.listing),
    appointments_page: pageUrl(ctx),
  };
}

const APPOINTMENT_TOOLS = [
  {
    name: 'list_appointment_packages',
    description:
      'List this workspace\'s appointment / contractor packages (purchased slots, booked, closed, open form leads, booking URL). ' +
      'Use for Appointments tracker questions: who still needs leads, package progress, GHL calendar sync status.',
    schema: z.object({}),
    run: listAppointmentPackages,
  },
  {
    name: 'create_appointment_package',
    description:
      'Create an appointment package for a contractor (slots to fill with leads). Owners/admins only. ' +
      'Prefer buying from list_appointment_marketplace when the slots are listed there.',
    schema: z.object({
      business_name: z.string().min(1).max(160).describe('Contractor / business name.'),
      trade: z.string().max(80).optional().describe('Trade, e.g. "Flooring", "HVAC".'),
      purchased: z.number().int().min(1).max(500).optional().describe('Appointment slots purchased (default 1).'),
      leads_purchased: z.number().int().min(0).max(500).optional().describe('Lead credits; defaults to purchased.'),
      contact_email: z.string().email().optional(),
      contact_phone: z.string().max(40).optional(),
      booking_url: z.string().url().optional().describe('GHL or other booking widget URL.'),
      website_url: z.string().url().optional(),
      ghl_calendar_id: z.string().optional(),
      ghl_calendar_name: z.string().optional(),
      form_match_tag: z.string().optional().describe('Tag that maps inbound form leads to this package.'),
      notes: z.string().max(500).optional(),
      lead_id: z.string().optional().describe('Optional CRM lead key this package is tied to.'),
    }),
    run: createAppointmentPackage,
  },
  {
    name: 'deliver_appointment_lead',
    description:
      'Push a homeowner / job lead into one appointment package (package_id) or several (package_ids or trade). Owners/admins only. ' +
      'Use after list_appointment_packages when the user wants to send work to a contractor package.',
    schema: z.object({
      package_id: z.string().optional().describe('Single package id from list_appointment_packages.'),
      package_ids: z.array(z.string().min(1)).max(50).optional().describe('Several package ids.'),
      trade: z.string().optional().describe('Deliver to all packages in this trade when no package_id(s).'),
      name: z.string().max(120).optional().describe('Homeowner / contact name.'),
      phone: z.string().max(40).optional(),
      email: z.string().email().optional(),
      note: z.string().max(2000).optional().describe('Job details.'),
      notes: z.string().max(2000).optional().describe('Alias for note.'),
      city: z.string().max(80).optional(),
      zip: z.string().max(16).optional(),
      address: z.string().max(200).optional(),
      lead_id: z.string().optional().describe('CRM lead id to attach when delivering from an existing lead.'),
    }),
    run: deliverAppointmentLead,
  },
  {
    name: 'list_appointment_marketplace',
    description:
      'Browse the shared appointment marketplace (packages other workspaces can buy), plus this workspace\'s recent purchases.',
    schema: z.object({
      trade: z.string().optional().describe('Filter by trade.'),
      include_sold_out: z.boolean().optional().describe('Include archived / sold-out listings (default false).'),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: listAppointmentMarketplace,
  },
  {
    name: 'buy_appointment_slots',
    description:
      'Buy slots from a marketplace listing (list_appointment_marketplace) into this workspace as a new appointment package. Owners/admins only.',
    schema: z.object({
      listing_id: z.string().min(1).describe('Marketplace listing id.'),
      quantity: z.number().int().min(1).max(500).optional().describe('How many slots to buy (default 1).'),
    }),
    run: buyAppointmentSlots,
  },
];

const BY_NAME = Object.fromEntries(APPOINTMENT_TOOLS.map((t) => [t.name, t]));
const APPOINTMENT_TOOL_NAMES = APPOINTMENT_TOOLS.map((t) => t.name);

async function executeAppointmentTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return APPOINTMENT_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  APPOINTMENT_TOOLS,
  APPOINTMENT_TOOL_NAMES,
  READ_ONLY_APPOINTMENT_TOOLS: ['list_appointment_packages', 'list_appointment_marketplace'],
  DESTRUCTIVE_APPOINTMENT_TOOLS: ['deliver_appointment_lead', 'buy_appointment_slots'],
  OPEN_WORLD_APPOINTMENT_TOOLS: ['buy_appointment_slots'],
  executeAppointmentTool,
  openAiFunctionTools,
};
