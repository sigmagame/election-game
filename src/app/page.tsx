"use client";

import { ArrowRight, Flag, Landmark, Users, Handshake } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/game-shell/theme-toggle";
import { Button } from "@/components/ui/button";

/** Seats of the parliament arc: [x, y, colour]. Purely decorative. */
const SEATS: Array<[number, number, string]> = [[150,300,"#6f7cf0"],[172,300,"#6f7cf0"],[194,300,"#6f7cf0"],[216,300,"#6f7cf0"],[238,300,"#6f7cf0"],[152,278,"#6f7cf0"],[174,278,"#6f7cf0"],[196,278,"#6f7cf0"],[219,276,"#6f7cf0"],[157,256,"#6f7cf0"],[180,256,"#6f7cf0"],[243,276,"#6f7cf0"],[203,257,"#6f7cf0"],[165,235,"#6f7cf0"],[189,236,"#6f7cf0"],[229,255,"#6f7cf0"],[176,216,"#6f7cf0"],[214,238,"#6f7cf0"],[202,218,"#6f7cf0"],[190,198,"#6f7cf0"],[256,256,"#6f7cf0"],[229,221,"#6f7cf0"],[245,237,"#6f7cf0"],[218,202,"#6f7cf0"],[206,183,"#6f7cf0"],[225,170,"#6f7cf0"],[236,189,"#6f7cf0"],[247,208,"#6f7cf0"],[265,224,"#6f7cf0"],[276,243,"#6f7cf0"],[245,160,"#6f7cf0"],[256,180,"#6f7cf0"],[267,199,"#ff8a3d"],[267,154,"#ff8a3d"],[278,174,"#ff8a3d"],[288,217,"#ff8a3d"],[289,195,"#ff8a3d"],[289,150,"#ff8a3d"],[300,172,"#ff8a3d"],[300,238,"#ff8a3d"],[311,150,"#ff8a3d"],[311,195,"#ff8a3d"],[312,217,"#ff8a3d"],[322,174,"#ff8a3d"],[333,154,"#ff8a3d"],[333,199,"#ff8a3d"],[344,180,"#ff8a3d"],[355,160,"#ff8a3d"],[324,243,"#ff8a3d"],[335,224,"#ff8a3d"],[375,170,"#ff8a3d"],[364,189,"#ff8a3d"],[353,208,"#ff8a3d"],[394,183,"#ff8a3d"],[382,202,"#ff8a3d"],[355,237,"#ff8a3d"],[371,221,"#ff8a3d"],[344,256,"#ff8a3d"],[410,198,"#ff8a3d"],[398,218,"#ff8a3d"],[386,238,"#ff8a3d"],[424,216,"#ff8a3d"],[371,255,"#ff8a3d"],[411,236,"#2fa84f"],[435,235,"#2fa84f"],[397,257,"#2fa84f"],[357,276,"#2fa84f"],[420,256,"#2fa84f"],[443,256,"#2fa84f"],[381,276,"#2fa84f"],[404,278,"#2fa84f"],[426,278,"#2fa84f"],[448,278,"#8b93a8"],[450,300,"#8b93a8"],[428,300,"#8b93a8"],[406,300,"#8b93a8"],[384,300,"#8b93a8"],[362,300,"#8b93a8"]];

const STEPS = [
  { name: "Home", text: "Start here, then open Setup." },
  { name: "Setup", text: "Election, party, alliance and seats." },
  { name: "Campaign", text: "Weekly actions across the regions." },
  { name: "Voting", text: "Polling day, phase by phase." },
  { name: "Results", text: "Seats, vote share and the outcome." },
  { name: "Negotiation", text: "Only if no bloc has a majority." },
  { name: "Government", text: "Share the ministries and form the cabinet." },
];

const FEATURES = [
  { icon: Flag, title: "Campaign week by week", text: "Spend a limited set of actions each week: rallies, door-to-door outreach and digital campaigns, aimed at the regions that matter." },
  { icon: Users, title: "Alliances and seat sharing", text: "Choose partners by strength and past relations, then divide the seats. Rival fronts campaign in the same regions." },
  { icon: Handshake, title: "Hung results and negotiation", text: "If nobody reaches a majority, talks run day by day with offers, outside support, a possible extension and a floor test." },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-[#1b2a6b] text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="flex items-center gap-3">
            <Landmark className="size-8 text-brand" aria-hidden />
            <span className="leading-tight">
              <span className="block font-heading text-lg font-semibold">Indian Election</span>
              <span className="block text-xs text-white/70">Simulator</span>
            </span>
          </Link>
          <nav className="flex flex-wrap gap-7 text-sm font-medium text-white/75" aria-label="Page sections">
            <Link href="/" className="text-brand">Home</Link>
            <a href="#how" className="hover:text-white">How to play</a>
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#announce" className="hover:text-white">About</a>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button asChild className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Link href="/elections/setup">Start new game</Link>
            </Button>
          </div>
        </div>
        <div className="flex h-1" aria-hidden>
          <div className="flex-1 bg-[#ff9933]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#138808]" />
        </div>
      </header>

      <section className="border-b border-border bg-muted/40">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-6 py-16">
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-5">
            <span className="text-sm font-semibold text-brand">Democracy, strategy, governance</span>
            <h1 className="font-heading text-5xl font-bold leading-[1.08]">
              Lead a party.
              <br />
              <span className="text-brand">Lead the People.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              Build your political party, form alliances, contest the Lok Sabha or a State Assembly election, and negotiate your way to government.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-12 bg-brand px-6 text-base text-brand-foreground hover:bg-brand/90">
                <Link href="/elections/setup">
                  Start new game <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
                <Link href="/elections/setup">Continue saved game</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Both buttons open the Setup page. Your game saves automatically in this browser.</p>
          </div>
          <div className="flex min-w-0 flex-[1_1_420px] justify-center">
            <div className="w-full max-w-[520px] rounded-2xl border border-border bg-card p-6">
              <svg viewBox="120 120 360 200" role="img" aria-label="A parliament seating arc coloured by alliance" className="block h-auto w-full">
                {SEATS.map(([x, y, c], i) => (
                  <circle key={i} cx={x} cy={y} r={7} fill={c} />
                ))}
              </svg>
              <div className="mt-3 flex justify-between text-sm text-muted-foreground">
                <span>Every seat counts</span>
                <span className="font-semibold text-foreground">Majority needed to govern</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="announce" className="mx-auto max-w-[1200px] px-6 pb-6 pt-16">
        <h2 className="font-heading text-3xl font-semibold">The election is announced</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Every game begins the way real elections do: with a notification from the election commission.</p>
        <video
          suppressHydrationWarning
          className="mt-8 aspect-video max-h-[560px] w-full rounded-2xl border border-border bg-black object-cover"
          src="/videos/election-notification.mp4"
          controls
          playsInline
          preload="metadata"
        />
      </section>

      <section id="features" className="mx-auto max-w-[1200px] px-6 pb-6 pt-12">
        <h2 className="font-heading text-3xl font-semibold">Every party has its own campaign</h2>
        <div className="mt-8 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-6">
              <Icon className="size-7 text-brand" aria-hidden />
              <h3 className="font-heading text-lg font-semibold">{title}</h3>
              <p className="text-[15px] leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1200px] px-6 pb-16 pt-12">
        <h2 className="font-heading text-3xl font-semibold">Your road to government</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Seven stages, each opening when the one before is finished. Progress is saved as you go.</p>
        <div className="mt-8 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          {STEPS.map((s, i) => (
            <div key={s.name} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <span className="grid size-[30px] place-items-center rounded-full bg-[#1b2a6b] text-sm font-semibold text-white">{i + 1}</span>
              <span className="font-heading text-base font-semibold">{s.name}</span>
              <span className="text-[13px] leading-normal text-muted-foreground">{s.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#1b2a6b] text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-6 px-6 py-14">
          <div className="min-w-0 flex-[1_1_420px]">
            <h2 className="font-heading text-3xl font-semibold">Ready to contest?</h2>
            <p className="mt-2 text-white/75">Setup takes three steps: choose the election, pick your party, then settle your alliance and seats.</p>
          </div>
          <Button asChild size="lg" className="h-12 bg-brand px-7 text-base text-brand-foreground hover:bg-brand/90">
            <Link href="/elections/setup">
              Go to Setup <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-5 text-center text-[13px] text-muted-foreground">
        Indian Election Simulator is a simulation game. Parties, results and events are simulated.
      </footer>
    </main>
  );
}
