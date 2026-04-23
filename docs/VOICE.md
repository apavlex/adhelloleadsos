# Agency OS — product voice

Use this for **every user-visible string** in the app (nav, headings, buttons, empty states, errors, coach copy).

## Tone: direct sales coach

- **You** and **we** — talk to the rep on the floor, not the architect reading docs.
- Short sentences. Confident. No hedging (“you might consider”) unless it’s compliance or irreversible risk.
- **Action-first**: lead with the verb (Pull leads, Call next, Save wrap-up). Explain why in one clause only when it changes behavior.
- **No UI tour prose** in page chrome: do not open with what the page “is” or how it relates to other pages. The nav and headings carry that. If onboarding is needed, use a **dismissible** first-run hint — not a permanent subtitle under the title.

## Avoid

- Internal jargon without payoff (`apply to location`, `Pipeline stage · Status` as labels without human meaning).
- Motivational poster filler (“Don’t worry about failure”) — replace with concrete next steps.
- Mixed metaphors across modules (growth PM vs Salesforce admin vs engineering README). One voice.

## Numbers and counts (single convention)

Use **label · count** (middle dot, space on each side):

- Tabs and pills: `Cold · 3`, `All · 12`, `YouTube · 0`
- Inline badges: `Warm inbound · 0`, `Streak · 4d` (unit on the number side when it’s part of the count)
- Selection / progress: `Selected · 3`, `Complete · 4/7`, `Touches · 12/54`
- Never mix `All (3)`, `3 leads in view`, `0 Leads Selected` in the same surface — normalize to the dot form.

## Errors

- Say what happened and the next action in one line. No stack traces in UI.

## Exceptions

- Legal / third-party disclaimers can stay literal.
- API docs and `docs/` technical writeups are not bound to coach tone.
