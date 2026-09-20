export const PAUSED_GIFT_CARD_CATEGORY = 'Gift Cards';

export function isPausedGiftCard(product: {
  product_categories?: { name: string } | null;
}): boolean {
  return product.product_categories?.name === PAUSED_GIFT_CARD_CATEGORY;
}
