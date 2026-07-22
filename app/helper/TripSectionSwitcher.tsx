"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { Camera, CheckCircle2 } from "lucide-react";

import { Button } from "../components/ui/button";

type TripSection = "detail" | "overview" | "quote" | "site" | "work";

const TripSectionNavigationContext = createContext<{
  openPurchase: () => void;
  openQuote: () => void;
  openSite: () => void;
  openWork: () => void;
} | null>(null);

export function useTripSectionNavigation() {
  return useContext(TripSectionNavigationContext);
}

export function TripSectionSwitcher({
  chrome,
  connection,
  detail,
  hideChromeInDetail = false,
  hideNavInDetail = false,
  initialSection,
  overview,
  quote,
  site,
  workChrome,
}: {
  chrome: ReactNode;
  connection: ReactNode;
  detail?: ReactNode;
  hideChromeInDetail?: boolean;
  hideNavInDetail?: boolean;
  initialSection: TripSection;
  overview: ReactNode;
  quote: ReactNode;
  site: ReactNode;
  workChrome?: ReactNode;
}) {
  const [activeSection, setActiveSection] = useState<TripSection>(initialSection);
  const shouldHideNav = hideNavInDetail && activeSection === "detail";
  const items = [
    {
      icon: <CheckCircle2 className="size-5" />,
      label: "總覽",
      section: "overview",
    },
    {
      icon: <Camera className="size-5" />,
      label: "連線",
      section: "work",
    },
  ] as const;

  return (
    <TripSectionNavigationContext.Provider
      value={{
        openPurchase: () => setActiveSection("detail"),
        openQuote: () => setActiveSection("quote"),
        openSite: () => setActiveSection("site"),
        openWork: () => setActiveSection("work"),
      }}
    >
      <div className={`grid gap-5 ${shouldHideNav ? "" : "pb-28"}`}>
        {(activeSection === "detail" && hideChromeInDetail) ||
        activeSection === "site" ||
        activeSection === "quote"
          ? null
          : activeSection === "work"
            ? workChrome || chrome
            : chrome}
        {["detail", "quote", "site"].includes(activeSection) ? (
          <div className="grid gap-4">
            {activeSection === "site"
              ? site
              : activeSection === "quote"
                ? quote
                : detail}
          </div>
        ) : activeSection === "overview" ? (
          overview
        ) : (
          connection
        )}
        {shouldHideNav ? null : (
          <nav
            aria-label="行程主要操作"
            className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur sm:left-1/2 sm:right-auto sm:w-[min(42rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-xl sm:border sm:p-2"
          >
            <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2">
              {items.map((item) => {
                const isActive =
                  activeSection === item.section ||
                  (item.section === "work" &&
                    ["detail", "quote", "site"].includes(activeSection));
                return (
                  <Button
                    aria-current={isActive ? "page" : undefined}
                    key={item.section}
                    onClick={() => setActiveSection(item.section)}
                    size="lg"
                    type="button"
                    variant={isActive ? "default" : "outline"}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </TripSectionNavigationContext.Provider>
  );
}
