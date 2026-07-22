import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { Button, type ButtonProps } from "./ui/button";

type BackButtonProps = Omit<ButtonProps, "children"> & {
  label: string;
};

type BackLinkProps = {
  className?: string;
  href: string;
  label: string;
  variant?: ButtonProps["variant"];
};

const backButtonClassName = "size-10 shrink-0 p-0";

export function BackButton({ className, label, ...props }: BackButtonProps) {
  return (
    <Button
      aria-label={label}
      className={cn(backButtonClassName, className)}
      title={label}
      {...props}
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
    </Button>
  );
}

export function BackLink({ className, href, label, variant = "ghost" }: BackLinkProps) {
  return (
    <Button asChild className={cn(backButtonClassName, className)} size="sm" variant={variant}>
      <Link aria-label={label} href={href} title={label}>
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Link>
    </Button>
  );
}
