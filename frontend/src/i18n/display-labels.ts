import type { TFunction } from "i18next";

type DisplayCategory = {
  id?: string;
  slug?: string;
  name: string;
  description?: string | null;
};

function translate(t: TFunction, key: string, fallback: string): string {
  return t(key, { defaultValue: fallback });
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getBusinessCategoryLabel(id: string, t: TFunction, fallback?: string): string {
  const canonicalId: Record<string, string> = {
    "restaurants-cafes": "restaurants",
    cafes: "restaurants",
    "hotels-accommodation": "hotels",
    accommodations: "hotels",
    apartments: "hotels",
    villas: "hotels",
    "tours-activities": "activities",
    tours: "activities",
    "car-rental": "transport",
    "health-wellness": "wellness",
    medical: "wellness",
    "spa-hamam": "wellness",
    "hair-beauty": "wellness",
  };
  return translate(t, `business.category.${canonicalId[id] || id}`, fallback ?? id);
}

export function getBusinessSubcategoryLabel(value: string, t: TFunction): string {
  return translate(t, `business.subcategory.${slugify(value)}`, value);
}

export function getForumCategoryLabel(category: DisplayCategory, t: TFunction): string {
  const stableId = category.slug || category.id || slugify(category.name);
  return translate(t, `community.category.${stableId}`, category.name);
}

export function getForumCategoryDescription(category: DisplayCategory, t: TFunction): string {
  const stableId = category.slug || category.id || slugify(category.name);
  return translate(
    t,
    `community.category.${stableId}.description`,
    category.description || "Discussions and questions in this category",
  );
}

export function getForumSubcategoryLabel(value: string, t: TFunction): string {
  return translate(t, `community.subcategory.${slugify(value)}`, value);
}

export function getBlogCategoryLabel(value: string, t: TFunction): string {
  return translate(t, `blog.category.${slugify(value)}`, value);
}

export function getBlogReadTimeLabel(value: string, t: TFunction): string {
  const minutes = value.match(/\d+/)?.[0];
  return minutes ? t("public.readTime", { count: Number(minutes) }) : value;
}

export function getShopCategoryLabel(value: string, t: TFunction): string {
  return translate(t, `shop.category.${slugify(value)}`, value);
}

export function getShopCategoryTag(value: string, t: TFunction): string {
  const tagByCategory: Record<string, string> = {
    "food-and-treats": "shop.tag.edible",
    "alanyaholidays-merch": "shop.tag.exclusive",
    "books-and-learning": "shop.tag.digital",
    "travel-essentials": "shop.tag.popular",
    "turkish-home-and-decor": "shop.tag.handmade",
    "turkish-textiles": "shop.tag.artisan",
    "gift-cards": "shop.tag.gift",
  };
  const key = tagByCategory[slugify(value)];
  return key ? t(key) : t("shop.tag.new");
}

export function getShopVariantLabel(tag: string, t: TFunction): string {
  if (tag === t("shop.tag.exclusive")) return t("public.sizes");
  if (tag === t("shop.tag.gift")) return t("public.tiers");
  return t("public.options");
}
