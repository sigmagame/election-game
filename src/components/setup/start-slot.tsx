"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Draws its children in the setup page's top "stage boxes" row (the #setup-start-slot element). */
export function StartSlot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the slot only exists in the DOM after the parent has rendered
    setSlot(document.getElementById("setup-start-slot"));
  }, []);
  return slot ? createPortal(children, slot) : null;
}
