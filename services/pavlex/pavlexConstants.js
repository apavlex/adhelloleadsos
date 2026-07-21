/** Shared Pavlex CRM command → tool mapping for system prompts. */
const CRM_COMMAND_HINTS = `
CRM MCP TOOLS — use these automatically when the user asks about leads or folders:
- "List my folders" / "list folders" / "show pipeline" → call list_folders
- "How many leads do I have?" (total) → call count_leads with no folder (workspace scope)
- "How many leads in [folder]?" → call count_leads with folder_name
- "Show leads in [folder]" / "first N leads" → call list_leads with folder_name and limit
- "Find [company name]" → call search_leads with query
- "Update this lead" / change phone, email, status, tags → call update_lead with lead_id and fields
Always use CRM tools for lead/folder/pipeline questions. Never guess counts or folder names.`;

module.exports = {
  CRM_COMMAND_HINTS,
};
