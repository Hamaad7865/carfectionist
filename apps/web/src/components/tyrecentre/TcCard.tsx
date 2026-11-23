"use client";

import type { ComponentProps } from "react";
import { Card } from "@/components/ui/card";

/** DESIGN-SPEC §4 card on HextaUI's `card`: radius 22, two-layer soft shadow, no hairline,
 *  no built-in spacing (each screen pads its own). Renders a <section> so it can carry a label. */
export function TcCard({ className = "", ...props }: Omit<ComponentProps<"section">, "ref">) {
  return (
    <Card
      size="flush"
      render={<section />}
      className={`gap-0 bg-white text-tc-body shadow-tc-card ring-0 [--card-radius:22px] ${className}`}
      {...props}
    />
  );
}
