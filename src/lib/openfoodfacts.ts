import { estimateShelfLifeDays, expiryDateFromToday } from "./shelflife";

interface OpenFoodFactsProduct {
  product_name?: string;
  product_name_id?: string;
  product_name_en?: string;
  categories_tags?: string[];
}

interface OpenFoodFactsResponse {
  status: number;
  product?: OpenFoodFactsProduct;
}

export interface ScannedProduct {
  name: string;
  category: string | null;
  suggestedExpiryDate: string | null;
}

function pickName(product: OpenFoodFactsProduct): string | null {
  const candidates = [product.product_name_id, product.product_name, product.product_name_en];
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

function pickCategory(categoryTags: string[] | undefined): string | null {
  if (!categoryTags || categoryTags.length === 0) return null;
  return categoryTags[0].replace(/^en:/, "").replace(/-/g, " ");
}

export async function lookupBarcode(barcode: string): Promise<ScannedProduct | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as OpenFoodFactsResponse;
    if (data.status !== 1 || !data.product) return null;
    const name = pickName(data.product);
    if (!name) return null;
    const days = estimateShelfLifeDays(data.product.categories_tags);
    return {
      name,
      category: pickCategory(data.product.categories_tags),
      suggestedExpiryDate: expiryDateFromToday(days)
    };
  } catch {
    return null;
  }
}
