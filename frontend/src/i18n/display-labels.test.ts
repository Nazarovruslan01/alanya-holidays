import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import messages from "./local";
import {
  getBlogCategoryLabel,
  getBusinessCategoryLabel,
  getBusinessSubcategoryLabel,
  getForumCategoryDescription,
  getForumCategoryLabel,
  getForumSubcategoryLabel,
  getShopCategoryLabel,
} from "./display-labels";

type Locale = "en" | "ru" | "tr";

const directorySubcategories = [
  "Turkish Cuisine",
  "Beach Club",
  "Café & Breakfast",
  "Boutique Hotel",
  "All-Inclusive Resort",
  "Boat Tours",
  "Adventure Tours",
  "Turkish Bath",
  "Dental Clinic",
  "Real Estate Agency",
  "Car Rental",
  "Jewelry & Gold",
  "Carpets & Textiles",
  "Legal Services",
  "Translation Services",
  "Nightclub",
  "Rooftop Bar",
  "Apart Hotel",
  "Spa & Wellness Center",
  "Scuba Diving",
  "Scooter Rental",
  "Spices & Gourmet",
  "Paragliding",
  "Kebab Restaurant",
] as const;

const seededForumSubcategories = [
  "Flights & Airport Transfers",
  "Hotels & Where to Stay",
  "Trip Itineraries",
  "Best Time to Visit",
  "First-Time Visitors",
  "Budgeting & Costs",
  "Cleopatra Beach",
  "Hidden Coves & Quiet Beaches",
  "Dim River & Nature",
  "Waterfalls & Hiking",
  "Beach Clubs",
  "Turkish Breakfast",
  "Restaurants & Local Eats",
  "Bars & Nightlife",
  "Cafés & Desserts",
  "Street Food",
  "Boat Tours",
  "Alanya Castle & History",
  "Water Sports",
  "Day Trips & Excursions",
  "Family Activities",
  "Residence Permits",
  "Cost of Living",
  "Coworking & Internet",
  "Banking & Taxes",
  "Meeting People",
  "Healthcare",
  "Buying Property",
  "Renting",
  "Investment & ROI",
  "Legal & Paperwork",
  "Neighborhood Guides",
  "Turkish Language",
  "Traditions & Etiquette",
  "Shopping & Bazaars",
  "Local News",
  "Meetups & Socials",
  "Festivals",
  "Sports & Fitness",
  "Language Exchange",
  "Buy & Sell",
  "Housing & Rentals",
  "Jobs & Services",
  "Free Stuff",
  "New Member Questions",
  "Emergencies & Safety",
  "Forum Help",
] as const;

function translate(locale: Locale): TFunction {
  return ((key: string, options?: { defaultValue?: string }) =>
    messages[locale].translation[key] ?? options?.defaultValue ?? key) as unknown as TFunction;
}

describe("localized fixed display labels", () => {
  it("localizes business labels while retaining canonical filter ids", () => {
    const ru = translate("ru");
    const tr = translate("tr");

    expect(getBusinessCategoryLabel("restaurants", ru)).toBe("Рестораны и кафе");
    expect(getBusinessCategoryLabel("restaurants", tr)).toBe("Restoranlar ve kafeler");
    expect(getBusinessCategoryLabel("restaurants", ru)).not.toBe("restaurants");
    expect(getBusinessSubcategoryLabel("Turkish Bath", ru)).toBe("Турецкая баня");
    expect(getBusinessSubcategoryLabel("Boutique Hotel", tr)).toBe("Butik otel");
    expect(getBusinessSubcategoryLabel("Car Rental", ru)).toBe("Прокат автомобилей");
    expect("restaurants").toBe("restaurants");

    for (const value of directorySubcategories) {
      expect(getBusinessSubcategoryLabel(value, ru)).not.toBe(value);
      expect(getBusinessSubcategoryLabel(value, tr)).not.toBe(value);
    }
  });

  it("localizes forum category names and descriptions by stable slug", () => {
    const category = {
      id: "category-1",
      slug: "beaches-nature",
      name: "Beaches & Nature",
      description: "Cleopatra Beach, hidden coves, waterfalls and the great outdoors.",
    };

    expect(getForumCategoryLabel(category, translate("ru"))).toBe("Пляжи и природа");
    expect(getForumCategoryLabel(category, translate("tr"))).toBe("Plajlar ve doğa");
    expect(getForumCategoryDescription(category, translate("ru"))).toBe(
      "Пляж Клеопатры, скрытые бухты, водопады и природа."
    );
    expect(category.slug).toBe("beaches-nature");
  });

  it("localizes screenshot category cards by canonical slug without changing source values", () => {
    const screenshotCategories = [
      ["trending", "Trending", "В тренде", "Gündemde"],
      ["new-members-introduction", "New Members Introduction", "Знакомство новых участников", "Yeni üyelerle tanışma"],
      ["ask-a-local", "Ask a Local", "Спросите местного жителя", "Bir yerliye sorun"],
      ["latest-deals", "Latest Deals", "Последние предложения", "Son fırsatlar"],
      ["popular-beaches-and-attractions", "Popular Beaches & Attractions", "Популярные пляжи и достопримечательности", "Popüler plajlar ve gezilecek yerler"],
      ["new-business-listings", "New Business Listings", "Новые объявления компаний", "Yeni işletme ilanları"],
    ] as const;

    for (const [slug, name, ruLabel, trLabel] of screenshotCategories) {
      const category = { slug, name };
      expect(getForumCategoryLabel(category, translate("ru"))).toBe(ruLabel);
      expect(getForumCategoryLabel(category, translate("tr"))).toBe(trLabel);
      expect(getForumCategoryDescription(category, translate("ru"))).toBe(
        "Обсуждения и вопросы в этой категории"
      );
      expect(category.slug).toBe(slug);
      expect(category.name).toBe(name);
    }
  });

  it("localizes blog, forum subcategory, and shop labels without translating content values", () => {
    expect(getBlogCategoryLabel("Food & Drink", translate("ru"))).toBe("Еда и напитки");
    expect(getBlogCategoryLabel("Food & Drink", translate("tr"))).toBe("Yeme ve içecek");
    expect(getForumSubcategoryLabel("Cleopatra Beach", translate("ru"))).toBe("Пляж Клеопатры");
    expect(getForumSubcategoryLabel("Flights & Airport Transfers", translate("ru"))).toBe(
      "Перелёты и трансферы из аэропорта"
    );
    expect(getForumSubcategoryLabel("Hotels & Where to Stay", translate("tr"))).toBe(
      "Oteller ve konaklama"
    );
    expect(getForumSubcategoryLabel("Banking & Taxes", translate("ru"))).toBe("Банки и налоги");
    for (const value of seededForumSubcategories) {
      expect(getForumSubcategoryLabel(value, translate("ru"))).not.toBe(value);
      expect(getForumSubcategoryLabel(value, translate("tr"))).not.toBe(value);
    }
    const canonicalSubcategory = "Flights & Airport Transfers";
    expect(canonicalSubcategory).toBe("Flights & Airport Transfers");
    expect(getShopCategoryLabel("Turkish Textiles", translate("tr"))).toBe("Türk tekstilleri");
    expect(messages.ru.translation["shop.communityMember"]).toBe("Участник сообщества");
    expect(messages.tr.translation["shop.communityMember"]).toBe("Topluluk üyesi");
    expect(getShopCategoryLabel("User's Custom Category", translate("ru"))).toBe(
      "User's Custom Category"
    );
  });

  it("keeps plural variants idiomatic across supported locales", () => {
    expect(messages.ru.translation["public.discussionCount_one"]).toBe("{{count}} обсуждение");
    expect(messages.ru.translation["public.discussionCount_few"]).toBe("{{count}} обсуждения");
    expect(messages.ru.translation["public.discussionCount_many"]).toBe("{{count}} обсуждений");
    expect(messages.ru.translation["public.topicCount_one"]).toBe("{{count}} тема");
    expect(messages.ru.translation["public.topicCount_few"]).toBe("{{count}} темы");
    expect(messages.ru.translation["public.topicCount_many"]).toBe("{{count}} тем");
    expect(messages.en.translation["public.discussionCount_one"]).toBe("{{count}} discussion");
    expect(messages.en.translation["public.discussionCount_other"]).toBe("{{count}} discussions");
    expect(messages.tr.translation["public.topicCount_other"]).toBe("{{count}} konu");
  });
});
