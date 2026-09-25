/** Shared Pavlex CRM command → tool mapping for system prompts. */
const CRM_COMMAND_HINTS = `
CRM MCP TOOLS — use these automatically when the user asks about leads, pipelines, tasks, or follow-ups:
- "Find [company]" / "search leads" → search_leads
- "List my folders" / "how many leads" → list_folders / count_leads
- "How many leads in Landscaping?" → count_leads with folder_name
- "Show leads in [folder]" / "first N leads" → list_leads with folder_name and limit
- "What's the status / stage of [lead]?" → get_lead and/or get_opportunity_board
- "Show my pipeline / prospecting stages" → list_opportunity_pipelines then get_opportunity_board
- "Create a pipeline" / "new opportunity board" → list_opportunity_pipelines (for templates) then create_opportunity_pipeline
- "Move [lead] to [stage]" → move_opportunity (stage_name or stage_id)
- "Enrich [lead]" / "find email" → enrich_lead
- "Who should I call today?" / "daily lead suggestions" → suggest_daily_leads
- "Remind me / follow-ups due" → list_followups
- "Create a task" / "update task" / "my tasks" → create_task / update_task / list_tasks
- "Update status / phone / tags" → update_lead
Always use CRM tools for lead/folder/pipeline/task questions. Never guess counts, stages, or folder names.`;

module.exports = {
  CRM_COMMAND_HINTS,
};
