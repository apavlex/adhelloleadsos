/** Shared Google Maps rating/review count parsing (no GHL API deps). */

function leadReviewValues(lead) {
  const rating = parseFloat(lead && (lead.totalScore ?? lead.rating ?? lead.total_score)) || 0;
  const reviews =
    parseInt(lead && (lead.reviewsCount ?? lead.reviews ?? lead.reviews_count), 10) || 0;
  return {
    rating: Number.isFinite(rating) && rating > 0 ? rating : 0,
    reviews: Number.isFinite(reviews) && reviews > 0 ? reviews : 0,
  };
}

function formatReviewSummaryForNote(lead) {
  const { rating, reviews } = leadReviewValues(lead);
  if (rating <= 0 && reviews <= 0) return '';
  if (rating > 0 && reviews > 0) {
    return `Google: ${Number(rating.toFixed(1))}★ (${reviews} reviews)`;
  }
  if (reviews > 0) return `Google: ${reviews} reviews`;
  return `Google: ${Number(rating.toFixed(1))}★`;
}

module.exports = {
  leadReviewValues,
  formatReviewSummaryForNote,
};
