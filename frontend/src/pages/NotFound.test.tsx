import "@testing-library/jest-dom";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import NotFound from "./NotFound";

const localizedNotFound = [
  {
    language: "en",
    heading: "Page not found",
    description: "The page you're looking for doesn't exist or may have moved.",
    home: "Home",
    explore: "Explore",
  },
  {
    language: "ru",
    heading: "Страница не найдена",
    description: "Возможно, страница удалена или ссылка устарела.",
    home: "Главная",
    explore: "Каталог мест",
  },
  {
    language: "tr",
    heading: "Sayfa bulunamadı",
    description: "Aradığınız sayfa kaldırılmış veya bağlantı güncel olmayabilir.",
    home: "Ana Sayfa",
    explore: "İşletme Rehberi",
  },
] as const;

describe("NotFound", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each(localizedNotFound)("renders the localized recovery view in $language", async ({
    language,
    heading,
    description,
    home,
    explore,
  }) => {
    await i18n.changeLanguage(language);

    render(
      <MemoryRouter initialEntries={["/missing-page"]}>
        <NotFound />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("/missing-page")).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: home })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: explore })).toHaveAttribute("href", "/explore");
    expect(screen.queryByText(/generate|создать|oluştur/i)).not.toBeInTheDocument();
  });
});
