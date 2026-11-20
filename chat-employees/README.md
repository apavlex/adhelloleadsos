# Custom chat employees (Grokbots & specialists)

Drop a `.json` file here to add another teammate to `/chat` and the floating assistant.
Restart or redeploy after adding files. Workspace owners can also add bots from the chat UI
(stored per workspace — no deploy needed).

## File shape

```json
{
  "id": "copy-grok",
  "name": "Copy Grok",
  "title": "Cold SMS specialist",
  "blurb": "Writes human cold texts that do not sound like AI.",
  "greeting": "Copy Grok here.",
  "emptyLead": "Draft and roast cold SMS and email openers",
  "placeholder": "Message Copy Grok…",
  "color": "#0ea5e9",
  "avatarKind": "grok",
  "family": "grok",
  "preferredOpenRouterModels": ["x-ai/grok-4", "x-ai/grok-4-fast"],
  "preferredXaiModels": ["grok-4", "grok-3-mini"],
  "identityPrompt": "You are Copy Grok, a specialized employee…",
  "suggestions": [
    { "icon": "script", "label": "Rewrite this opener", "prompt": "Rewrite this cold SMS so it does not sound like AI." }
  ]
}
```

- `family: "grok"` routes through your personal xAI key when set (Workspace → Integrations → xAI / Grok), then OpenRouter Grok models.
- Built-in `alex` and `grokbot` always exist; a file with the same `id` overrides the built-in.
