/** Shared Pavlex CRM command → tool mapping for system prompts. */
const CRM_COMMAND_HINTS = `
CRM MCP TOOLS — use these automatically when the user asks about leads or folders:
- "List my folders" / "list folders" → call list_folders
- "How many leads in [folder]?" → call count_leads with folder_name
- "Show leads in [folder]" / "first N leads" → call list_leads with folder_name and limit
- "Find [company name]" → call search_leads with query
- "Update this lead" / change phone, email, status, tags → call update_lead with lead_id and fields
Always use tools for CRM questions instead of guessing.`;

module.exports = {
  CRM_COMMAND_HINTS,
};
