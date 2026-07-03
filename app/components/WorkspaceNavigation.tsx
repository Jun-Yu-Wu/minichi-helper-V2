"use client";

import {
  CalendarDays,
  ClipboardList,
  CreditCard,
  Home,
  House,
  Merge,
  PackageSearch,
  Radio,
  Truck,
  Users,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

import { WorkspaceNav } from "./WorkspaceNav";

export function HelperWorkspaceNavigation() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const activeView = searchParams.get("tripId")
    ? "trips"
    : ["trips", "settlement", "rebuy", "warehouse"].includes(requestedView || "")
      ? requestedView || "home"
      : "home";
  const items = [
    { href: "/helper", icon: <House className="size-4" />, id: "home", label: "首頁" },
    { href: "/helper?view=trips", icon: <CalendarDays className="size-4" />, id: "trips", label: "行程" },
    { href: "/helper?view=settlement", icon: <CreditCard className="size-4" />, id: "settlement", label: "結帳" },
    { href: "/helper?view=rebuy", icon: <PackageSearch className="size-4" />, id: "rebuy", label: "補買" },
    { href: "/helper?view=warehouse", icon: <Truck className="size-4" />, id: "warehouse", label: "集運倉" },
  ];
  return <WorkspaceNav activeId={activeView} ariaLabel="小幫手主要導覽" items={items} />;
}

export function AdminWorkspaceNavigation() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const activeView = [
    "main",
    "checkout",
    "tasks",
    "rebuy",
    "live",
    "merge",
  ].includes(requestedView || "")
    ? requestedView || "home"
    : "home";
  const items = [
    { href: "/admin", icon: <Home className="size-4" />, id: "home", label: "總覽" },
    { href: "/admin?view=main", icon: <Users className="size-4" />, id: "main", label: "行程與人員" },
    { href: "/admin?view=checkout", icon: <CreditCard className="size-4" />, id: "checkout", label: "結帳" },
    { href: "/admin?view=tasks", icon: <ClipboardList className="size-4" />, id: "tasks", label: "任務發布" },
    { href: "/admin?view=rebuy", icon: <PackageSearch className="size-4" />, id: "rebuy", label: "補買" },
    { href: "/admin?view=live", icon: <Radio className="size-4" />, id: "live", label: "即時回傳" },
    { href: "/admin?view=merge", icon: <Merge className="size-4" />, id: "merge", label: "審核合併" },
  ];
  return <WorkspaceNav activeId={activeView} ariaLabel="管理員主要導覽" items={items} />;
}
