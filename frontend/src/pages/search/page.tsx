import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Navbar from "@/pages/home/components/Navbar";
import Footer from "@/pages/home/components/Footer";
import { forumService } from "@/api-services/forum.service";
import { eventsService } from "@/api-services/events.service";
import { directoryService } from "@/api-services/directory.service";
import { productsService } from "@/api-services/products.service";
import { blogService } from "@/api-services/blog.service";
import "@/i18n";

const sections = [
  "threads",
  "events",
  "members",
  "businesses",
  "products",
  "articles",
] as const;
type Section = (typeof sections)[number];
export type ResultTab = "all" | Section;
type Item = { id: string; title: string; description?: string; href: string };
type SectionState = {
  items: Item[];
  page: number;
  status: "loading" | "ready" | "error";
  hasMore: boolean;
};
export type SearchResult = Record<Section, SectionState>;
const PAGE_SIZE = 20;
const emptyResults = (): SearchResult => {
  const empty = (): SectionState => ({
    items: [],
    page: 0,
    status: "loading",
    hasMore: false,
  });
  return {
    threads: empty(),
    events: empty(),
    members: empty(),
    businesses: empty(),
    products: empty(),
    articles: empty(),
  };
};

async function findResults(
  section: Section,
  query: string,
  page: number,
  signal: AbortSignal,
): Promise<Item[]> {
  const offset = (page - 1) * PAGE_SIZE;
  const options = {
    signal,
    limit: PAGE_SIZE,
    offset,
    params: { search: query, offset },
  };
  switch (section) {
    case "threads": {
      const result = await forumService.getThreads(options);
      return result.threads.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.excerpt,
        href: `/thread/${encodeURIComponent(item.id)}`,
      }));
    }
    case "events": {
      const result = await eventsService.getEvents({
        ...options,
        includeUnpublished: false,
      });
      return result.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.location,
        href: "/events",
      }));
    }
    case "members": {
      const result = await forumService.getMembers(options);
      return result.map((item) => ({
        id: item.id,
        title: item.fullName,
        href: `/member/${encodeURIComponent(item.id)}`,
      }));
    }
    case "businesses": {
      const result = await directoryService.searchListings(query, {
        page,
        limit: PAGE_SIZE,
        signal,
      });
      return result.data.map((item) => ({
        id: item.id,
        title: item.name,
        description: item.address,
        href: `/business/${encodeURIComponent(item.id)}`,
      }));
    }
    case "products": {
      const result = await productsService.getShopCatalog({
        signal,
        params: { search: query, page, limit: PAGE_SIZE },
      });
      return result.products.map((item) => ({
        id: String(item.id),
        title: item.name,
        description: item.description ?? undefined,
        href: `/shop/${item.id}`,
      }));
    }
    case "articles": {
      const result = await blogService.getPosts({
        search: query,
        page,
        limit: PAGE_SIZE,
        status: "published",
        contentType: "blog",
        signal,
      });
      return result.posts.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.excerpt,
        href: `/blog/${encodeURIComponent(item.slug)}`,
      }));
    }
  }
}

export function HighlightMatch({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    <>
      {text.split(new RegExp(`(${escaped})`, "i")).map((part, index) =>
        part.toLocaleLowerCase() === trimmed.toLocaleLowerCase() ? (
          <mark
            key={index}
            className="bg-primary-100/70 text-foreground-900 rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default function SearchPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").slice(0, 200);
  const trimmed = query.trim();
  const [activeTab, setActiveTab] = useState<ResultTab>("all");
  const [results, setResults] = useState<SearchResult>(emptyResults);
  const controller = useRef<AbortController | null>(null);

  function changeQuery(value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }

  async function load(
    section: Section,
    page: number,
    search: string,
    signal: AbortSignal,
  ) {
    setResults((current) => ({
      ...current,
      [section]: { ...current[section], status: "loading" },
    }));
    try {
      const items = await findResults(section, search, page, signal);
      if (signal.aborted) return;
      setResults((current) => {
        const previous = page === 1 ? [] : current[section].items;
        const ids = new Set(previous.map((item) => item.id));
        return {
          ...current,
          [section]: {
            items: [...previous, ...items.filter((item) => !ids.has(item.id))],
            page,
            status: "ready",
            hasMore: items.length === PAGE_SIZE,
          },
        };
      });
    } catch {
      if (!signal.aborted)
        setResults((current) => ({
          ...current,
          [section]: { ...current[section], status: "error" },
        }));
    }
  }

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setResults(emptyResults());
    const timer = setTimeout(() => {
      if (trimmed)
        sections.forEach((section) => {
          void load(section, 1, trimmed, request.signal);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [trimmed]);

  return (
    <div className="min-h-screen bg-background-50 flex flex-col">
      <Navbar />
      <main className="flex-1 min-w-0 px-4 md:px-8 pt-24 md:pt-28 pb-16">
        <div className="max-w-5xl mx-auto">
          <h1 className="font-heading text-3xl text-foreground-900 mb-3">
            {t("public.search.title")}
          </h1>
          <p className="text-foreground-500 mb-6">
            {t("public.search.description")}
          </p>
          <div className="flex min-w-0 gap-2 items-center rounded-xl border border-background-200 bg-white p-2 mb-6">
            <input
              type="search"
              aria-label={t("public.search.title")}
              placeholder={t("public.search.placeholder")}
              maxLength={200}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent p-2 text-foreground-900 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-lg"
            />
            {query && (
              <button
                type="button"
                onClick={() => changeQuery("")}
                aria-label={t("public.clearSearch")}
                className="shrink-0 p-3 rounded-lg focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                ×
              </button>
            )}
          </div>
          {!trimmed ? (
            <div className="py-12 text-center">
              <h2 className="text-xl mb-2">
                {t("public.search.initialTitle")}
              </h2>
              <p className="text-foreground-500">
                {t("public.search.initialDescription")}
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                {[
                  "beaches",
                  "residence",
                  "nomad",
                  "breakfast",
                  "coworking",
                  "hiking",
                ].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      changeQuery(t(`public.search.suggestion.${key}`))
                    }
                    className="rounded-full border px-3 py-2 text-sm"
                  >
                    {t(`public.search.suggestion.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div
                className="flex flex-wrap gap-2 mb-8"
                aria-label={t("public.search.sections")}
              >
                {(["all", ...sections] as const).map((section) => (
                  <button
                    key={section}
                    type="button"
                    aria-pressed={activeTab === section}
                    onClick={() => setActiveTab(section)}
                    className={`rounded-full px-4 py-2 text-sm ${activeTab === section ? "bg-primary-500 text-white" : "bg-background-100 text-foreground-700"}`}
                  >
                    {t(
                      section === "all"
                        ? "public.search.all"
                        : `public.search.section.${section}`,
                    )}
                  </button>
                ))}
              </div>
              {sections
                .filter(
                  (section) => activeTab === "all" || activeTab === section,
                )
                .map((section) => {
                  const state = results[section];
                  return (
                    <section
                      key={section}
                      aria-labelledby={`search-${section}`}
                      className="mb-8 min-w-0"
                    >
                      <h2
                        id={`search-${section}`}
                        className="font-heading text-xl mb-3"
                      >
                        {t(`public.search.section.${section}`)}
                      </h2>
                      {state.items.length > 0 && (
                        <p className="text-sm text-foreground-500 mb-3">
                          {t("public.search.loaded", {
                            count: state.items.length,
                          })}
                        </p>
                      )}
                      <div className="space-y-3">
                        {state.items.map((item) => (
                          <Link
                            key={item.id}
                            to={item.href}
                            className="block rounded-xl border border-background-200 bg-white p-4 break-words hover:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500"
                          >
                            <h3 className="font-semibold">
                              <HighlightMatch
                                text={item.title}
                                query={trimmed}
                              />
                            </h3>
                            {item.description && (
                              <p className="mt-1 text-sm text-foreground-500 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                          </Link>
                        ))}
                      </div>
                      {state.status === "loading" && (
                        <p role="status" className="py-4 text-foreground-500">
                          {t("public.search.searching")}
                        </p>
                      )}
                      {state.status === "ready" && state.items.length === 0 && (
                        <p className="text-foreground-500">
                          {t("public.search.noResults")}
                        </p>
                      )}
                      {state.status === "error" && (
                        <p role="alert" className="mt-3 text-rose-700">
                          {t("public.search.failed")}
                        </p>
                      )}
                      {(state.status === "error" || state.hasMore) && (
                        <button
                          type="button"
                          disabled={state.status === "loading"}
                          className="mt-3 rounded-lg border px-4 py-2 disabled:opacity-50"
                          onClick={() => {
                            if (controller.current)
                              void load(
                                section,
                                state.page + 1,
                                trimmed,
                                controller.current.signal,
                              );
                          }}
                        >
                          {t(
                            state.status === "error"
                              ? "public.search.retry"
                              : "public.search.more",
                          )}
                        </button>
                      )}
                    </section>
                  );
                })}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
