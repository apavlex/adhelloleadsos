/**
 * Home-service trades from ServiceTitan industries — subfolders under Businesses.
 * @see https://www.servicetitan.com/industries
 */

const TRADE_FOLDERS = [
  { name: 'HVAC', slug: 'hvac', keyword: 'HVAC contractor' },
  { name: 'Plumbing', slug: 'plumbing', keyword: 'plumber' },
  { name: 'Electrical', slug: 'electrical', keyword: 'electrician' },
  { name: 'Garage door', slug: 'garage_door', keyword: 'garage door repair' },
  { name: 'Chimney sweep', slug: 'chimney_sweep', keyword: 'chimney sweep' },
  { name: 'Roofing', slug: 'roofing', keyword: 'roofing contractor' },
  { name: 'Irrigation', slug: 'irrigation', keyword: 'irrigation contractor' },
  { name: 'Water treatment', slug: 'water_treatment', keyword: 'water treatment' },
  { name: 'Septic', slug: 'septic', keyword: 'septic service' },
  { name: 'Painting', slug: 'painting', keyword: 'painting contractor' },
  { name: 'Pool service', slug: 'pool_service', keyword: 'pool service' },
  { name: 'Landscaping', slug: 'landscaping', keyword: 'landscaping' },
  { name: 'Lawn care', slug: 'lawn_care', keyword: 'lawn care' },
  { name: 'Pest control', slug: 'pest_control', keyword: 'pest control' },
  { name: 'Air duct cleaning', slug: 'air_duct_cleaning', keyword: 'air duct cleaning' },
  { name: 'Kitchen equipment', slug: 'kitchen_equipment', keyword: 'commercial kitchen equipment' },
  { name: 'Audio visual', slug: 'audio_visual', keyword: 'audio visual installer' },
  { name: 'Alarm & security', slug: 'alarm', keyword: 'alarm security' },
  { name: 'Appliance repair', slug: 'appliance_repair', keyword: 'appliance repair' },
  { name: 'Remodeling', slug: 'remodeling', keyword: 'remodeling contractor' },
  { name: 'Locksmith', slug: 'locksmith', keyword: 'locksmith' },
  { name: 'Refrigeration', slug: 'refrigeration', keyword: 'refrigeration repair' },
  { name: 'Handyman', slug: 'handyman', keyword: 'handyman' },
  { name: 'Gutter', slug: 'gutter', keyword: 'gutter installation' },
  { name: 'Siding', slug: 'siding', keyword: 'siding contractor' },
  { name: 'Dock & door', slug: 'dock_door', keyword: 'dock and door' },
  { name: 'Fire & life safety', slug: 'fire_life_safety', keyword: 'fire protection' },
  { name: 'Mechanical', slug: 'mechanical', keyword: 'mechanical contractor' },
];

const BY_SLUG = TRADE_FOLDERS.reduce((acc, row) => {
  acc[row.slug] = row;
  return acc;
}, {});

module.exports = {
  TRADE_FOLDERS,
  BY_SLUG,
};
