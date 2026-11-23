import type { ReactNode } from "react";

export const percent = (value: number) => `${value.toFixed(1)}%`;

export function ReportCard({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0b1e31] p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
      {children}
    </section>
  );
}

export function ReportTable({ headers, rows, highlight = [] }: { headers: string[]; rows: string[][]; highlight?: boolean[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>{headers.map((header) => <th key={header} className="pb-3 pr-4">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={`border-t border-white/10 ${highlight[index] ? "text-orange-200" : ""}`}>
              {row.map((cell, cellIndex) => <td key={cellIndex} className="py-2 pr-4">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1e31] p-4">
      <div className="flex items-center gap-2 text-orange-300">{icon}<span className="text-xs text-slate-400">{label}</span></div>
      <p className="mt-3 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
