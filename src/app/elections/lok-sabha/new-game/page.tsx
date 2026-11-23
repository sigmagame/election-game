"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Setup now lives on one page; this old address forwards there. */
export default function Redirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/elections/setup?type=lok-sabha");
  }, [router]);
  return <p className="p-8 text-muted-foreground">Opening setup…</p>;
}
