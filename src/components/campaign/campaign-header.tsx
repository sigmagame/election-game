import { Badge } from "@/components/ui/badge";

/**
 * The top of every Campaign page: what the stage is, the pills that matter this week, and the
 * 12-week timeline (done / current / to come).
 */
export function CampaignHeader({
  title,
  subtitle,
  facts,
  currentWeek,
  totalWeeks,
  completedWeeks,
  actionsLeft,
  actionsMax,
  locked = false,
  action,
}: {
  title: string;
  subtitle: string;
  /** Short facts about the election, such as seats and majority. */
  facts: Array<[string, string]>;
  currentWeek?: number;
  totalWeeks: number;
  completedWeeks: number[];
  actionsLeft?: number;
  actionsMax: number;
  locked?: boolean;
  /** The Start Campaign button, or a saved notice. */
  action?: React.ReactNode;
}) {
  const started = currentWeek !== undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {facts.map(([label, value]) => (
            <Badge key={label} variant="outline" className="h-7 px-3 text-sm">
              {label}: <b className="ml-1">{value}</b>
            </Badge>
          ))}
          {started && !locked ? (
            <Badge className="h-7 px-3 text-sm">
              Actions left: {actionsLeft ?? actionsMax} / {actionsMax}
            </Badge>
          ) : null}
          {action}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Campaign timeline</span>
          <span className="text-muted-foreground">
            {locked ? "Campaign locked: voting has begun" : started ? `Week ${currentWeek} of ${totalWeeks}` : `${totalWeeks} weeks`}
          </span>
        </div>
        <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${totalWeeks}, minmax(0, 1fr))` }} aria-label="Campaign weeks">
          {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
            const done = locked || completedWeeks.includes(week);
            const current = started && !locked && week === currentWeek;
            return (
              <li
                key={week}
                title={`Week ${week}`}
                className={`h-3 rounded-sm ${done ? "bg-success" : current ? "bg-brand" : "bg-muted"}`}
              />
            );
          })}
        </ol>
      </div>
    </div>
  );
}
