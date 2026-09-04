import { useState, useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { productsService, type ConciergeEnquiryEntry as RecentEnquiry } from "@/api-services/products.service";
import { getShopCategoryLabel } from "@/i18n/display-labels";

function timeAgo(dateStr: string, t: TFunction): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t("shop.time.justNow");
  if (diffMins < 60) return t("shop.time.minutesAgo", { count: diffMins });
  if (diffHours < 24) return t("shop.time.hoursAgo", { count: diffHours });
  if (diffDays === 1) return t("shop.time.yesterday");
  if (diffDays < 7) return t("shop.time.daysAgo", { count: diffDays });
  if (diffDays < 30) return t("shop.time.weeksAgo", { count: Math.floor(diffDays / 7) });
  return t("shop.time.monthsAgo", { count: Math.floor(diffDays / 30) });
}

const CATEGORY_ICONS: Record<string, string> = {
  "Clothing & Apparel": "ri-t-shirt-line",
  "Home Decor & Ceramics": "ri-home-smile-line",
  "Turkish Delight & Food": "ri-cake-line",
  "Textiles & Towels": "ri-checkbox-blank-line",
  "Leather Goods": "ri-handbag-line",
  "Jewelry & Accessories": "ri-vip-diamond-line",
  "Gift Items": "ri-gift-line",
  "Travel Experiences": "ri-plane-line",
};

export default function RecentEnquiriesSidebar() {
  const { t } = useTranslation();
  const [enquiries, setEnquiries] = useState<RecentEnquiry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchEnquiries() {
      try {
        setLoading(true);
        const data = await productsService.getRecentEnquiries(8);
        if (!cancelled) {
          setEnquiries(data || []);
        }
      } catch {
        // silent fail — sidebar is not critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchEnquiries();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <aside className="w-full lg:w-72 flex-shrink-0">
        <div className="sticky top-24">
          <div className="animate-pulse space-y-4">
            <div className="h-5 w-32 bg-background-200 rounded"></div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-background-200/70 space-y-2">
                <div className="h-3 w-24 bg-background-200 rounded"></div>
                <div className="h-3 w-16 bg-background-100 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (enquiries.length === 0) return null;

  return (
    <aside className="w-full lg:w-72 flex-shrink-0">
      <div className="sticky top-24">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center">
            <i className="ri-history-line text-accent-600 text-sm"></i>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">{t("shop.recentlySubmitted")}</h3>
            <p className="text-xs text-foreground-400">{t("shop.recentEnquiriesCount", { count: enquiries.length })}</p>
          </div>
        </div>

        <div className="space-y-2.5">
          {enquiries.map((enquiry, index) => {
            const icon = CATEGORY_ICONS[enquiry.category] || "ri-shopping-bag-line";

            return (
              <div
                key={`${enquiry.submitted_at}-${index}`}
                className="bg-white rounded-xl p-3.5 border border-background-200/70 hover:border-accent-200/60 transition-colors cursor-default"
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-accent-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className={`${icon} text-accent-500 text-xs`}></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground-800 truncate">
                      {t("shop.communityMember")}
                    </p>
                    <p className="text-xs text-foreground-500 truncate mt-0.5">
                      {getShopCategoryLabel(enquiry.category, t)}
                    </p>
                    <p className="text-[11px] text-foreground-300 mt-1">
                      {timeAgo(enquiry.submitted_at, t)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-background-100">
          <p className="text-[11px] text-foreground-400 leading-relaxed">
            <i className="ri-information-line text-foreground-300 mr-1"></i>
            {t("shop.recentEnquiriesInfo")} {" "}
            <span className="text-accent-500 font-medium cursor-pointer">
              {t("shop.submitEnquiryAbove")}
            </span>
            .
          </p>
        </div>
      </div>
    </aside>
  );
}
