/**
 * AI Demo Generator
 *
 * Generates personalized demo pages for prospects based on their business type.
 * Three demo types:
 * 1. Lead Qualifier Bot — AI chatbot that qualifies leads
 * 2. Customer Service Chatbot — AI that answers common questions
 * 3. Appointment Scheduler — AI that books appointments
 *
 * Each demo is pre-loaded with the prospect's business info for a personalized feel.
 */

const demos = {
  leadQualifier: {
    id: 'lead-qualifier',
    title: 'AI Lead Qualifier Bot',
    description: 'Automatically qualify leads 24/7 with an AI chatbot that asks the right questions and routes hot leads to your team.',
    icon: '🤖',
    benefits: [
      'Qualifies leads while you\'re on the job',
      'Never miss a hot lead again',
      'Routes leads to the right team member',
      'Works 24/7 — even on weekends',
    ],
    demoScript: (business) => ({
      greeting: `Hi! I'm ${business.title}'s AI assistant. I can help you get a quote or schedule a service.`,
      questions: [
        { q: 'What service do you need?', options: getServices(business.categoryName) },
        { q: 'When do you need it?', options: ['ASAP', 'This week', 'This month', 'Just browsing'] },
        { q: 'What\'s your budget range?', options: ['Under $500', '$500-$2000', '$2000+', 'Not sure yet'] },
      ],
      cta: 'Based on your answers, I\'ll connect you with the right team member. Can I get your name and number?',
    }),
  },

  customerService: {
    id: 'customer-service',
    title: 'AI Customer Service Chatbot',
    description: 'Answer common customer questions instantly — hours, pricing, services, FAQs — without picking up the phone.',
    icon: '💬',
    benefits: [
      'Answers FAQs instantly, day or night',
      'Reduces missed calls and voicemails',
      'Frees up your team for high-value work',
      'Consistent answers every time',
    ],
    demoScript: (business) => ({
      greeting: `Welcome to ${business.title}! I'm here to help. What can I assist you with today?`,
      questions: [
        { q: 'What would you like to know?', options: ['Hours & Location', 'Services & Pricing', 'Book an Appointment', 'Talk to a Person'] },
        { q: 'Which service are you interested in?', options: getServices(business.categoryName) },
      ],
      cta: 'I can book that for you right now! Or would you prefer to speak with someone on our team?',
    }),
  },

  appointmentScheduler: {
    id: 'appointment-scheduler',
    title: 'AI Appointment Scheduler',
    description: 'Let customers book appointments directly from your website or Google listing — no phone tag, no missed calls.',
    icon: '📅',
    benefits: [
      'Customers book 24/7 — even after hours',
      'Reduces phone tag and missed calls',
      'Syncs with your calendar automatically',
      'Sends automatic reminders to reduce no-shows',
    ],
    demoScript: (business) => ({
      greeting: `Let's get you scheduled with ${business.title}! I can find the perfect time for you.`,
      questions: [
        { q: 'What service do you need?', options: getServices(business.categoryName) },
        { q: 'What day works best?', options: ['Today', 'Tomorrow', 'This week', 'Next week'] },
        { q: 'What time preference?', options: ['Morning (8am-12pm)', 'Afternoon (12pm-5pm)', 'Evening (5pm-8pm)'] },
      ],
      cta: 'Great! I found a slot for you. Can I get your name and phone number to confirm?',
    }),
  },
};

/**
 * Get relevant services based on business category.
 */
function getServices(category) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('plumb')) return ['Leak Repair', 'Drain Cleaning', 'Water Heater', 'Pipe Replacement', 'Other'];
  if (cat.includes('hvac') || cat.includes('heat') || cat.includes('air')) return ['AC Repair', 'Heating Repair', 'Maintenance', 'Installation', 'Other'];
  if (cat.includes('landscap') || cat.includes('lawn')) return ['Lawn Mowing', 'Landscape Design', 'Tree Service', 'Irrigation', 'Other'];
  if (cat.includes('clean')) return ['House Cleaning', 'Deep Cleaning', 'Move-in/out', 'Office Cleaning', 'Other'];
  if (cat.includes('roof')) return ['Roof Repair', 'Roof Replacement', 'Inspection', 'Leak Repair', 'Other'];
  if (cat.includes('electric')) return ['Wiring', 'Panel Upgrade', 'Lighting', 'Generator', 'Other'];
  if (cat.includes('tree')) return ['Tree Removal', 'Trimming', 'Stump Grinding', 'Emergency', 'Other'];
  if (cat.includes('pressure') || cat.includes('wash')) return ['Driveway', 'House Siding', 'Deck/Patio', 'Gutter Cleaning', 'Other'];
  if (cat.includes('junk') || cat.includes('removal')) return ['House Cleanout', 'Furniture Removal', 'Construction Debris', 'Yard Waste', 'Other'];
  return ['Service 1', 'Service 2', 'Service 3', 'Consultation', 'Other'];
}

/**
 * Generate a personalized demo for a specific business.
 */
function generateDemo(business, demoType = 'leadQualifier') {
  const demo = demos[demoType] || demos.leadQualifier;
  const script = demo.demoScript(business);

  return {
    ...demo,
    business: {
      title: business.title,
      category: business.categoryName || 'Home Service',
      phone: business.phone || '',
      website: business.website || '',
      address: business.address || '',
      city: business.city || '',
      state: business.state || '',
    },
    script,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate all three demos for a business.
 */
function generateAllDemos(business) {
  return {
    leadQualifier: generateDemo(business, 'leadQualifier'),
    customerService: generateDemo(business, 'customerService'),
    appointmentScheduler: generateDemo(business, 'appointmentScheduler'),
  };
}

/**
 * Generate a shareable demo URL with embedded business data.
 */
function generateDemoUrl(baseUrl, business, demoType = 'leadQualifier') {
  const params = new URLSearchParams({
    business: business.title || '',
    category: business.categoryName || '',
    city: business.city || '',
    state: business.state || '',
    phone: business.phone || '',
  });
  return `${baseUrl}/demo/${demoType}?${params.toString()}`;
}

module.exports = {
  demos,
  generateDemo,
  generateAllDemos,
  generateDemoUrl,
  getServices,
};
