import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const location = useLocation();
  const { t } = useTranslation();
  
  return (
    <div className="relative flex flex-col items-center justify-center h-screen text-center px-4">
      <h1 className="absolute bottom-0 text-9xl md:text-[12rem] font-black text-gray-50 select-none pointer-events-none z-0">
        404
      </h1>
      <div className="relative z-10">
        <h1 className="text-xl md:text-2xl font-semibold mt-6">{t("common.pageNotGenerated", "Page not found")}</h1>
        <p className="mt-2 text-base text-gray-400 font-mono">{location.pathname}</p>
        <p className="mt-4 text-lg md:text-xl text-gray-500">{t("common.tellAboutPage", "The page you're looking for doesn't exist or may have moved.")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/" className="rounded-full bg-foreground-900 px-5 py-2 text-sm font-medium text-white hover:bg-foreground-800">
            {t("nav.home", "Home")}
          </Link>
          <Link to="/explore" className="rounded-full border border-foreground-300 px-5 py-2 text-sm font-medium text-foreground-900 hover:bg-foreground-50">
            {t("nav.explore", "Explore")}
          </Link>
        </div>
      </div>
    </div>
  );
}
