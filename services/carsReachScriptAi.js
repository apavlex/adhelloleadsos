const { chatCompletion, parseLlmJson } = require('./llmClient');
const {
  CARS_REACH_SPECIALTY_LABEL,
  CARS_REACH_ELEVATOR_EXAMPLES,
  CARS_REACH_FOLLOWUP_EXAMPLES,
  CARS_REACH_APPOINTMENT_EXAMPLES,
  defaultElevatorScript,
  defaultFollowupScript,
  defaultAppointmentScript,
} = require('../config/carsReachScripts');

function sanitizeNetworkingScript(text) {
  let s = String(text || '').trim();
  s = s.replace(/^here(?:'|')?s (?:a |an |the |your |.+?'s )?(?:elevator speech|follow-up message|script|message):?\s*/i, '');
  s = s.replace(/^---+\s*\n?/gm, '');
  s = s.replace(/^["']|["']$/g, '');
  const whyIdx = s.search(/\n\s*\*?\*?Why it works/i);
  if (whyIdx > 0) s = s.slice(0, whyIdx).trim();
  return s.trim();
}

function elevatorSystemPrompt(specialtyLabel) {
  const examples = CARS_REACH_ELEVATOR_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n');
  return `You write 30-second networking elevator speeches for BNI, chamber events, and meetups.

Specialty being pitched: ${specialtyLabel}

Match this voice — conversational, first person, ~30 seconds when spoken aloud:

${examples}

Rules:
- Start with "Hi, I'm [Name] —"
- One clear outcome you help with (leads, visibility, customers, reviews, etc.)
- End with a soft ask for intros or connections
- Sound human, not corporate — no buzzword soup
- Output ONLY the words they will say aloud (no labels, no "Why it works", no quotes wrapper)
- 45-75 words

Respond with JSON only: {"script":"spoken elevator speech"}`;
}

function followupSystemPrompt() {
  const examples = CARS_REACH_FOLLOWUP_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n');
  return `You write short post-networking-event follow-up messages (text, LinkedIn DM, or email).

Match this warm, low-pressure tone:

${examples}

Rules:
- Start with "Hey [Name]!"
- Reference where you met and something about their business type
- Friendly, not salesy — coffee or continuing the conversation
- 2-4 sentences max
- Output ONLY the message text — no labels or meta commentary

Respond with JSON only: {"script":"follow-up message"}`;
}

function appointmentSystemPrompt() {
  const examples = CARS_REACH_APPOINTMENT_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n');
  return `You write in-person networking "transition to appointment" scripts — something you say at the end of a good conversation to book a low-pressure follow-up call.

Match this natural, respectful tone:

${examples}

Rules:
- Acknowledge you're both there to meet people / work the room
- Suggest a brief 15-minute call with optional time if provided
- "No pitch" / "no agenda" / low pressure framing
- 2-4 sentences, spoken aloud
- Output ONLY the script — no bullet lists or "Why it works"

Respond with JSON only: {"script":"transition script"}`;
}

async function generateCarsReachScript(input) {
  const scriptType = String(input.scriptType || '').trim().toLowerCase();
  const regenerate = !!input.regenerate;
  const currentScript = String(input.currentScript || '').trim();

  if (scriptType === 'elevator') {
    const yourName = String(input.yourName || '').trim();
    const specialtyKey = String(input.specialtyKey || 'general').trim();
    const specialtyLabel =
      String(input.specialtyLabel || '').trim() ||
      CARS_REACH_SPECIALTY_LABEL[specialtyKey] ||
      'General Digital Marketing';
    if (!yourName) {
      return { success: false, error: 'Enter your name first.' };
    }
    if (!regenerate && !currentScript) {
      return {
        success: true,
        script: defaultElevatorScript(yourName, specialtyKey, specialtyLabel),
        provider: 'default',
      };
    }
    let userContent = `Name: ${yourName}\nSpecialty: ${specialtyLabel}`;
    if (regenerate && currentScript) {
      userContent += `\n\nCurrent draft (write a fresh variation, same length and tone):\n${currentScript.slice(0, 3000)}`;
    } else {
      userContent += '\n\nWrite the elevator speech now.';
    }
    return runAi(elevatorSystemPrompt(specialtyLabel), userContent, regenerate ? 0.7 : 0.55);
  }

  if (scriptType === 'followup') {
    const theirName = String(input.theirName || '').trim();
    const theirBusinessType = String(input.theirBusinessType || '').trim();
    const whereMet = String(input.whereMet || '').trim();
    if (!theirName || !whereMet) {
      return { success: false, error: 'Enter their name and where you met.' };
    }
    if (!regenerate && !currentScript) {
      return {
        success: true,
        script: defaultFollowupScript(theirName, theirBusinessType, whereMet),
        provider: 'default',
      };
    }
    let userContent = `Their name: ${theirName}\nBusiness type: ${theirBusinessType || 'business'}\nWhere met: ${whereMet}`;
    if (regenerate && currentScript) {
      userContent += `\n\nCurrent draft (fresh variation):\n${currentScript.slice(0, 3000)}`;
    } else {
      userContent += '\n\nWrite the follow-up message now.';
    }
    return runAi(followupSystemPrompt(), userContent, regenerate ? 0.68 : 0.52);
  }

  if (scriptType === 'appointment') {
    const suggestedTime = String(input.suggestedTime || '').trim();
    if (!regenerate && !currentScript) {
      return {
        success: true,
        script: defaultAppointmentScript(suggestedTime),
        provider: 'default',
      };
    }
    let userContent = suggestedTime
      ? `Suggested time to mention: ${suggestedTime}`
      : 'No specific time — suggest something flexible like "this week" or "tomorrow afternoon".';
    if (regenerate && currentScript) {
      userContent += `\n\nCurrent draft (fresh variation):\n${currentScript.slice(0, 3000)}`;
    } else {
      userContent += '\n\nWrite the transition script now.';
    }
    return runAi(appointmentSystemPrompt(), userContent, regenerate ? 0.65 : 0.5);
  }

  return { success: false, error: 'Invalid script type.' };
}

async function runAi(systemPrompt, userContent, temperature) {
  const ai = await chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    jsonObject: true,
    max_tokens: 400,
    temperature,
  });

  if (!ai.content || ai.error) {
    return { success: false, error: ai.error || 'AI request failed. Set OPENROUTER_API_KEY.' };
  }

  const parsed = parseLlmJson(ai.content);
  let script = parsed && typeof parsed.script === 'string' ? sanitizeNetworkingScript(parsed.script) : '';
  if (!script) {
    return { success: false, error: 'Invalid AI response' };
  }

  return { success: true, script, provider: ai.provider || 'unknown' };
}

module.exports = {
  generateCarsReachScript,
  sanitizeNetworkingScript,
};
