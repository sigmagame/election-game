"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The home page now leads straight to Setup; this old hub address forwards there. */
export default function Redirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/elections/setup?type=lok-sabha");
  }, [router]);
  return <p className="p-8 text-muted-foreground">Opening setup…</p>;
}
