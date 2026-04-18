# Agency OS — Improved Leads Flow Spec (Cursor-Ready)

**Purpose:** Paste this doc into Cursor as implementation context or use it as a phased build prompt.

> **Repo stack note:** This repository (`adhelloleadsos`) currently ships as **Node.js + Express + EJS** with Replit KV / file-backed JSON persistence. Sections below describe the **target** architecture (**Next.js App Router + Prisma/Postgres**). Porting teams should map Prisma models to existing `services/database.js` patterns or migrate DB first.

---

## 1. Project Context

- **Repo:** adhello-leadsos (target: **Next.js** app, **Cloud Run**).
- **Goal:** Unify warm + cold lead sources into one automated pipeline with auto-routing, sequenced outreach, reply detection, and growth loops (referrals, upsells, nurture).
- **Target stack assumptions:** Next.js App Router, Prisma + Postgres (or Firestore), Apify + Google Maps scraping, OpenAI optional, Cloud Run cron for Autopilot.

---

## 2. Data Model Changes

### Lead (extend existing)

```prisma
model Lead {
  id              String   @id @default(cuid())
  companyName     String
  contactName     String?
  email           String?  @unique
  phone           String?
  website         String?
  location        String?
  category        String?             // business vertical / trade (maps to categoryName today)

  // NEW — source + routing
  source          LeadSource          // COLD_SCRAPE | CSV | INBOUND_AUDIT | INBOUND_BLUEPRINT | REFERRAL | ADS | MANUAL
  sourceDetail    String?             // e.g. "apify:google-maps", "adhello.ai/audit"
  temperature     Temperature         // COLD | WARM | HOT
  utm             Json?               // {source, medium, campaign, term, content}

  // NEW — scoring
  gapScore        Int      @default(0)      // 0-100
  gapFlags        String[]                  // ["no_website","low_reviews","no_chatbot","no_schema"]
  icpScore        Int      @default(0)      // fit score
  intentSignals   Json?                     // {hiring:true, adsRunning:true, techStack:[...]}

  // NEW — pipeline
  stage           Stage    @default(NEW)
  stageEnteredAt  DateTime @default(now())
  ownerId         String?
  nextActionAt    DateTime?
  lastTouchAt     DateTime?

  // NEW — lifecycle flags
  isClient        Boolean  @default(false)
  wonAt           DateTime?
  lostAt          DateTime?
  lostReason      String?
  nurtureUntil    DateTime?

  touches         Touch[]
  sequenceRuns    SequenceRun[]
  tasks           Task[]
  notes           Note[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum LeadSource {
  COLD_SCRAPE
  CSV
  INBOUND_AUDIT
  INBOUND_BLUEPRINT
  REFERRAL
  ADS
  MANUAL
}

enum Temperature {
  COLD
  WARM
  HOT
}

enum Stage {
  NEW              // 1. just discovered (ingested / triage)
  CONTACTED        // 1.5 sequence started
  ENGAGED          // 1.75 replied / booked
  CQI              // 2. discovery call done
  TRIAL_CLOSE      // 3. pitched $297
  TRIAL_ONBOARD    // 4.
  RETAINER_CLOSE   // 5.
  RETAINER_ONBOARD // 6.
  UPSELL           // 7.
  REFERRAL_ASK     // 8.
  WON
  LOST
  NURTURE
}
```

### New tables

```prisma
model Touch {
  id        String   @id @default(cuid())
  leadId    String
  lead      Lead @relation(fields: [leadId], references: [id])
  channel   Channel   // EMAIL | LINKEDIN | CALL | SMS | DM | BID
  direction Direction // OUTBOUND | INBOUND
  status    TouchStatus // SENT | DELIVERED | OPENED | CLICKED | REPLIED | BOUNCED
  subject   String?
  body      String?
  sentiment Sentiment? // POSITIVE | NEUTRAL | OBJECTION | UNSUBSCRIBE | OOO
  createdAt DateTime @default(now())
}

model Sequence {
  id        String  @id @default(cuid())
  name      String
  audience  Temperature   // which temp it's for
  persona   String?       // Paul | Clay | Bob
  steps     Json          // [{dayOffset:0, channel:"EMAIL", templateId:"cold_v1"}, ...]
  active    Boolean @default(true)
}

model SequenceRun {
  id         String @id @default(cuid())
  leadId     String
  sequenceId String
  stepIndex  Int    @default(0)
  status     RunStatus // ACTIVE | PAUSED | COMPLETED | STOPPED_REPLIED
  startedAt  DateTime @default(now())
  nextRunAt  DateTime?
}

model Task {
  id        String   @id @default(cuid())
  leadId    String?
  title     String
  dueAt     DateTime
  doneAt    DateTime?
  type      TaskType // CALL | FOLLOWUP | REFERRAL_ASK | UPSELL_CHECK | NURTURE
}

model Rule {
  id        String  @id @default(cuid())
  name      String
  trigger   String  // event name
  condition Json    // JSON logic
  action    Json    // {type, payload}
  enabled   Boolean @default(true)
}
```

*(Add enums `Channel`, `Direction`, `TouchStatus`, `Sentiment`, `RunStatus`, `TaskType` as needed.)*

---

## 3. High-Level Flow Diagram

```
┌─────────────────── SOURCES ───────────────────┐
│ Apify/Maps  LinkedIn/Apollo  CSV  Ads  Webhook│
│ Referral   adhello.ai Audit   adhello.ai Blueprint
└──────────────────────┬────────────────────────┘
                       ▼
             ┌─────────────────────┐
             │  INGEST + NORMALIZE │  dedupe by email/domain
             └─────────┬───────────┘
                       ▼
             ┌─────────────────────┐
             │  ENRICH (async job) │  site scan, socials, tech,
             │                     │  reviews, ads-library
             └─────────┬───────────┘
                       ▼
             ┌─────────────────────┐
             │  SCORE + CLASSIFY   │  gapScore, icpScore,
             │                     │  temperature = f(source)
             └─────────┬───────────┘
                       ▼
        ┌──────────────┴──────────────┐
        ▼ COLD                        ▼ WARM / HOT
 Stage: NEW                     Stage: ENGAGED (skip cold)
        │                              │
        ▼                              ▼
 Auto-enroll in               Notify owner + auto-task
 Cold Sequence                "Personal reply <5min"
 (Paul persona)                       │
        │                              │
        ▼                              ▼
 CONTACTED ──reply──▶ ENGAGED ──────▶ CQI
        │                              │
        │ no reply x N                 ▼
        ▼                         TRIAL_CLOSE ($297)
    NURTURE (90d)                      │
                                       ▼
                                 TRIAL_ONBOARD
                                       │
                                       ▼
                                 RETAINER_CLOSE
                                       │
                                       ▼
                                 RETAINER_ONBOARD
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
              UPSELL             REFERRAL_ASK            (WON)
            (day 60/90)           (day 30)
                  │                    │
                  └──────┐     ┌──────┘
                         ▼     ▼
                     Feeds top of funnel
```

---

## 4. Stage Definitions (Entry / Exit Criteria)

| Stage | Entry | Exit | SLA | Auto-action on entry |
|-------|--------|------|-----|------------------------|
| **NEW** | Created from any source | Sequence enrolled OR manually advanced | 24h | If COLD → enroll cold sequence. If WARM → skip to ENGAGED. |
| **CONTACTED** | First outbound touch sent | Reply received OR sequence completed | Sequence length | Track opens/clicks, schedule next step. |
| **ENGAGED** | Reply received OR call booked OR inbound form filled | CQI completed | 48h | Create task “Book/hold CQI call”, notify owner in Slack. |
| **CQI** | Discovery call completed, notes logged | Trial pitched | 3 days | AI summarize call notes → suggest pitch angle. |
| **TRIAL_CLOSE** | $297 offer sent | Paid OR declined | 5 days | Generate Stripe link, send template. |
| **TRIAL_ONBOARD** | Payment received | Deliverable shipped | 7 days | Kickoff email, create onboarding checklist. |
| **RETAINER_CLOSE** | Trial win delivered | Retainer signed OR declined | 7 days | Proposal auto-draft from CQI notes. |
| **RETAINER_ONBOARD** | Contract signed | Week-1 deliverables live | 14 days | Slack channel, tracking pixels, asset intake form. |
| **UPSELL** | 60–90 days post onboarding | Upsell accepted/declined | 14 days | Auto-task + Bob persona script. |
| **REFERRAL_ASK** | 30 days post onboarding w/ positive NPS | Ask sent | 7 days | Templated email with tracked ref link. |
| **WON** | Any close | — | — | Fire `lead.won` event → attribution. |
| **LOST** | Declined OR ghosted past SLA | Re-entry after nurture | — | Set `nurtureUntil = now + 90d`, move to NURTURE. |
| **NURTURE** | From LOST or cold no-reply | Re-engagement reply | 90 days | Monthly value email, quarterly check-in. |

---

## 5. Routing Rules (Rule Engine Seed)

```json
[
  {
    "name": "Warm inbound fast-track",
    "trigger": "lead.created",
    "condition": { "source": ["INBOUND_AUDIT", "INBOUND_BLUEPRINT", "REFERRAL"] },
    "action": {
      "type": "set_stage",
      "stage": "ENGAGED",
      "notify": "slack:#hot-leads",
      "task": "Personal reply <5min"
    }
  },
  {
    "name": "Cold auto-sequence",
    "trigger": "lead.scored",
    "condition": { "temperature": "COLD", "icpScore": { "$gte": 60 } },
    "action": { "type": "enroll_sequence", "sequenceId": "cold_paul_v1" }
  },
  {
    "name": "Low ICP → nurture",
    "trigger": "lead.scored",
    "condition": { "icpScore": { "$lt": 40 } },
    "action": { "type": "set_stage", "stage": "NURTURE" }
  },
  {
    "name": "Reply detected",
    "trigger": "touch.received",
    "condition": { "sentiment": { "$in": ["POSITIVE", "OBJECTION"] } },
    "action": { "type": "stop_sequence", "set_stage": "ENGAGED", "notify": "owner" }
  },
  {
    "name": "Referral ask day-30",
    "trigger": "cron.daily",
    "condition": { "stage": "RETAINER_ONBOARD", "daysSince": "wonAt>=30", "npsHealthy": true },
    "action": { "type": "advance", "stage": "REFERRAL_ASK", "task": "Send referral ask" }
  },
  {
    "name": "Upsell day-60",
    "trigger": "cron.daily",
    "condition": { "stage": "RETAINER_ONBOARD", "daysSince": "wonAt>=60" },
    "action": { "type": "create_task", "type_": "UPSELL_CHECK" }
  },
  {
    "name": "Stage SLA breach",
    "trigger": "cron.hourly",
    "condition": { "stageEnteredAt": { "$oldestThan": "stage.sla" } },
    "action": { "type": "create_task", "title": "Unstick {{stage}}", "notify": "owner" }
  }
]
```

---

## 6. API Routes to Add

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/leads/ingest` | Unified ingest (`source` in body) |
| `POST` | `/api/webhooks/inbound/audit` | adhello.ai audit completion |
| `POST` | `/api/webhooks/inbound/form` | Typeform/Tally |
| `POST` | `/api/webhooks/calendar` | Cal.com / Calendly booking |
| `POST` | `/api/webhooks/email` | Inbound email parser (reply detection) |
| `POST` | `/api/leads/[id]/enrich` | Trigger enrichment |
| `POST` | `/api/leads/[id]/score` | Re-score |
| `POST` | `/api/leads/[id]/advance` | `{ toStage }` |
| `POST` | `/api/sequences/[id]/enroll` | `{ leadId }` |
| `POST` | `/api/sequences/runner` | Cron: process `nextRunAt <= now` |
| `POST` | `/api/rules/evaluate` | Internal |
| `GET` | `/api/analytics/attribution` | Revenue by source |

---

## 7. File / Module Tasks for Cursor

Create or modify:

| Path | Task |
|------|------|
| `prisma/schema.prisma` | Data model above |
| `lib/leads/ingest.ts` | Normalize + dedupe |
| `lib/leads/enrich.ts` | BuiltWith, PageSpeed, socials, reviews |
| `lib/leads/score.ts` | `gapScore` + `icpScore` + temperature |
| `lib/rules/engine.ts` | JSON-logic rule runner |
| `lib/rules/seed.ts` | Seed default rules |
| `lib/sequences/runner.ts` | Cron-driven step executor |
| `lib/sequences/templates/cold_paul_v1.ts` | 7-step cold email + LI sequence |
| `lib/sequences/templates/warm_clay_v1.ts` | 3-step warm follow-up |
| `lib/email/provider.ts` | Instantly / Smartlead adapter |
| `lib/email/inboundParser.ts` | Classify reply sentiment (OpenAI) |
| `lib/events/bus.ts` | `lead.created`, `lead.scored`, `touch.received`, `stage.changed` |
| `app/api/leads/ingest/route.ts` | … |
| `app/api/webhooks/inbound/audit/route.ts` | … |
| `app/api/webhooks/calendar/route.ts` | … |
| `app/api/sequences/runner/route.ts` | Hit by Cloud Run cron every 5 min |
| `app/(dashboard)/sales/page.tsx` | Command Center: unify cold + warm |
| `app/(dashboard)/leads/page.tsx` | Source + temperature filters |
| `app/(dashboard)/leads/[id]/page.tsx` | Lead detail + timeline |
| `app/(dashboard)/analytics/page.tsx` | Attribution by source |
| `components/PipelineBoard.tsx` | Add CONTACTED, ENGAGED, NURTURE columns |
| `components/LeadTimeline.tsx` | Touches + stage transitions |
| `components/SourceBadge.tsx` | Color-coded chip |

---

## 8. Cursor Prompt (paste this)

You are working in the adhello-leadsos **Next.js** repo. Implement the improved leads flow per `/docs/LEADS_FLOW.md`. Proceed in this order, committing after each phase:

1. **Phase 1 — Schema & Events:** Extend Lead; add Touch, Sequence, SequenceRun, Task, Rule. Create `/lib/events/bus.ts` emitting `lead.created`, `lead.scored`, `touch.received`, `stage.changed`. Run migration.

2. **Phase 2 — Ingest & Routing:** Unify all sources through `/api/leads/ingest`. Add webhooks for inbound audit, calendar, form, email. Implement rule engine + seed the 7 rules in section 5. Warm/inbound leads must skip to ENGAGED.

3. **Phase 3 — Enrichment & Scoring:** Async job pipeline computing `gapScore`, `icpScore`, `temperature`. Trigger `lead.scored` on completion.

4. **Phase 4 — Sequences:** Sequence runner cron (every 5 min). Ship `cold_paul_v1` (7 steps over 14 days, email + LinkedIn) and `warm_clay_v1` (3 steps over 5 days). Stop sequence on reply via inbound email parser (OpenAI sentiment).

5. **Phase 5 — UI:** Update Pipeline board with new stages (CONTACTED, ENGAGED, NURTURE). Lead detail timeline. Source/temperature filters + badges. Attribution panel on Analytics.

6. **Phase 6 — Loops:** Referral-ask day-30 and upsell day-60 crons. Nurture re-engagement monthly email.

**Tests:** Rule engine, ingest dedupe, stage transitions. Use existing design system; do not introduce new CSS libs.

---

## 9. Acceptance Criteria

1. A scraped Google Maps lead flows: **NEW → CONTACTED (auto) → ENGAGED (on reply) → CQI** without manual stage clicks.
2. An adhello.ai audit submission creates a lead at **ENGAGED** with a **5-minute owner task** and never enters a cold sequence.
3. A lead that replies mid-sequence **auto-pauses** the sequence and **notifies** the owner.
4. **30 days** after a lead hits **RETAINER_ONBOARD**, a **REFERRAL_ASK** task is auto-created.
5. Analytics page shows **revenue** and **conversion rate** per **source**.
6. Lost leads re-surface via **NURTURE** after **90 days** with a value email.

---

## 10. Mapping notes (Express codebase today)

When implementing inside **this** repo without a full Next migration:

| Spec concept | Current approximate location |
|--------------|------------------------------|
| Lead | `services/database.js` (`lead:*`), `pipelineStage` 1–10 |
| Ingest | `routes/api.js` `/ingest`, webhooks |
| Sequences | `services/sequenceEngine.js`, `sequenceTemplates.js` |
| Rules | New module; can start as `services/ruleEngine.js` + KV `rule:*` |
| Events | New `services/eventBus.js` or lightweight emit from ingest/score |

Use this table to prioritize **parity** before swapping the runtime to Next.js.
