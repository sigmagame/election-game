import { Suspense } from "react";
import { SetupPage } from "@/components/setup/setup-page";

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-muted-foreground">Loading setup…</p>}>
      <SetupPage />
    </Suspense>
  );
}
