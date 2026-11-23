import { GameShell } from "@/components/game-shell/game-shell";

export default function ElectionsLayout({ children }: { children: React.ReactNode }) {
  return <GameShell>{children}</GameShell>;
}
