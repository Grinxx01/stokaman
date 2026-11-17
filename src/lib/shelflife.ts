const SHELF_LIFE_DAYS: Array<[string, number]> = [
  ["en:breads", 4],
  ["en:baked-goods", 5],
  ["en:cakes", 5],
  ["en:cookies", 180],
  ["en:snacks", 180],
  ["en:chocolate", 300],
  ["en:candies", 365],
  ["en:dairies", 10],
  ["en:milks", 14],
  ["en:cheeses", 21],
  ["en:butters", 60],
  ["en:meats", 4],
  ["en:chicken", 4],
  ["en:beef", 5],
  ["en:pork", 4],
  ["en:fishes", 3],
  ["en:seafood", 3],
  ["en:eggs", 21],
  ["en:tofus", 5],
  ["en:tempehs", 5],
  ["en:noodles", 240],
  ["en:pastas", 240],
  ["en:rice", 365],
  ["en:canned-foods", 540],
  ["en:instant-noodles", 180],
  ["en:frozen-foods", 180],
  ["en:ice-creams", 180],
  ["en:beverages", 180],
  ["en:soft-drinks", 270],
  ["en:juices", 120],
  ["en:teas", 365],
  ["en:coffees", 365],
  ["en:waters", 540],
  ["en:cooking-sauces", 270],
  ["en:spices", 365],
  ["en:cooking-oils", 365],
  ["en:sugars", 730],
  ["en:flours", 270],
  ["en:fruits", 7],
  ["en:vegetables", 7],
  ["en:fresh-foods", 5]
];

export function estimateShelfLifeDays(categoryTags: string[] | undefined): number | null {
  if (!categoryTags || categoryTags.length === 0) return null;
  for (const tag of categoryTags) {
    for (const [candidate, days] of SHELF_LIFE_DAYS) {
      if (tag === candidate) return days;
    }
  }
  for (const tag of categoryTags) {
    for (const [candidate, days] of SHELF_LIFE_DAYS) {
      if (tag.includes(candidate.slice(3))) return days;
    }
  }
  return null;
}

export function expiryDateFromToday(days: number | null): string | null {
  if (days === null) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
