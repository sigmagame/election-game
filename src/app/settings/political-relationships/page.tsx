"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import partyData from "@/data/parties.json";

type Relationship =
  | "UNDEFINED"
  | "STRONG_ALLY"
  | "FRIENDLY"
  | "NEUTRAL"
  | "RIVAL"
  | "STRONG_RIVAL";
type Scope = "national" | "state";

const relationships: { value: Relationship; label: string }[] = [
  { value: "UNDEFINED", label: "Undefined" },
  { value: "STRONG_ALLY", label: "Strong Ally" },
  { value: "FRIENDLY", label: "Friendly" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "RIVAL", label: "Rival" },
  { value: "STRONG_RIVAL", label: "Strong Rival" },
];

const states = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu and Kashmir", "Puducherry",
];

const STORAGE_KEY = "election-game-party-relationships";

// Sorting the IDs creates one shared key for AAP-BJP and BJP-AAP.
const getPairId = (partyA: string, partyB: string) =>
  [partyA, partyB].sort().join("__");

export default function PoliticalRelationshipsPage() {
  const [scope, setScope] = useState<Scope>("national");
  const [selectedState, setSelectedState] = useState("Maharashtra");
  const [selectedParty, setSelectedParty] = useState("AAP");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | Relationship>("ALL");
  const [nationalData, setNationalData] = useState<Record<string, Relationship>>({});
  const [stateData, setStateData] = useState<Record<string, Record<string, Relationship>>>({});
  const [loaded, setLoaded] = useState(false);

  const parties = partyData.parties;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates client-only saved state after mount (localStorage is unavailable during SSR)
        setNationalData(parsed.national || {});
        setStateData(parsed.states || {});
      }
    } catch {
      console.error("Could not load saved political relationships.");
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ national: nationalData, states: stateData })
    );
  }, [nationalData, stateData, loaded]);

  const getNationalRelationship = (pairId: string): Relationship =>
    nationalData[pairId] || "UNDEFINED";

  // State-specific values override national values; otherwise inherit the national value.
  const getEffectiveRelationship = (pairId: string): Relationship => {
    if (scope === "national") return getNationalRelationship(pairId);
    return stateData[selectedState]?.[pairId] ?? getNationalRelationship(pairId);
  };

  const hasStateOverride = useCallback(
    (pairId: string) => Object.prototype.hasOwnProperty.call(stateData[selectedState] || {}, pairId),
    [stateData, selectedState],
  );

  const updateRelationship = (pairId: string, value: Relationship) => {
    if (scope === "national") {
      setNationalData((previous) => ({ ...previous, [pairId]: value }));
    } else {
      setStateData((previous) => ({
        ...previous,
        [selectedState]: {
          ...previous[selectedState],
          [pairId]: value,
        },
      }));
    }
  };

  const resetCurrentScope = () => {
    const message = scope === "national"
      ? "Reset all national relationships? State-specific overrides will remain."
      : `Reset all relationship overrides for ${selectedState}? National relationships will remain.`;
    if (!window.confirm(message)) return;

    if (scope === "national") {
      setNationalData({});
    } else {
      setStateData((previous) => {
        const updated = { ...previous };
        delete updated[selectedState];
        return updated;
      });
    }
  };

  const otherParties = useMemo(
    () => parties.filter((party) => party.id !== selectedParty),
    [parties, selectedParty]
  );

  const filteredParties = otherParties.filter((party) => {
    const matchesSearch = party.id.toLowerCase().includes(search.toLowerCase());
    const relationship = getEffectiveRelationship(getPairId(selectedParty, party.id));
    return matchesSearch && (filter === "ALL" || relationship === filter);
  });

  const totalPairs = (parties.length * (parties.length - 1)) / 2;
  const configuredCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < parties.length; i++) {
      for (let j = i + 1; j < parties.length; j++) {
        const id = getPairId(parties[i].id, parties[j].id);
        if (scope === "national") {
          if (nationalData[id] && nationalData[id] !== "UNDEFINED") count++;
        } else if (hasStateOverride(id)) {
          count++;
        }
      }
    }
    return count;
  }, [parties, nationalData, scope, hasStateOverride]);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 dark:bg-slate-950 dark:text-white sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-orange-500">Game Settings</p>
          <h1 className="mt-2 text-3xl font-bold">Political Relationships</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Select one party to view and edit its relationship with every other party. The same relationship appears when you select the other party.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Relationship scope</h2>
              <p className="mt-1 text-sm text-slate-500">State-specific relationships can override national relationships.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setScope("national")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${scope === "national" ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>National</button>
              <button onClick={() => setScope("state")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${scope === "state" ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>State</button>
            </div>
          </div>
          {scope === "state" && (
            <div className="mt-5 max-w-sm">
              <label className="mb-2 block text-sm font-medium">Select state / UT</label>
              <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" style={{ colorScheme: "light dark" }}>
                {states.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500">Total unique party pairs</p>
            <p className="mt-2 text-3xl font-bold">{totalPairs}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500">{scope === "national" ? "Configured nationally" : "State overrides"}</p>
            <p className="mt-2 text-3xl font-bold text-orange-500">{configuredCount}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500">Parties in master list</p>
            <p className="mt-2 text-3xl font-bold">{parties.length}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">Select party from index</label>
              <select value={selectedParty} onChange={(e) => { setSelectedParty(e.target.value); setSearch(""); setFilter("ALL"); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" style={{ colorScheme: "light dark" }}>
                {parties.map((party) => <option key={party.id} value={party.id}>{party.id}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Search other parties</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by party ID..." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:w-64">
              <label className="mb-2 block text-sm font-medium">Filter by relationship</label>
              <select value={filter} onChange={(e) => setFilter(e.target.value as "ALL" | Relationship)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" style={{ colorScheme: "light dark" }}>
                <option value="ALL">All relationships</option>
                {relationships.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <button onClick={resetCurrentScope} className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">
              {scope === "national" ? "Reset national relationships" : `Reset ${selectedState} overrides`}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
            <div>
              <h2 className="font-semibold">Relationships of {selectedParty}</h2>
              <p className="mt-1 text-sm text-slate-500">{filteredParties.length} of {otherParties.length} other parties</p>
            </div>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300">{scope === "national" ? "National" : selectedState}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Selected party</th>
                  <th className="px-4 py-3">Other party</th>
                  <th className="px-4 py-3">Relationship</th>
                  {scope === "state" && <th className="px-4 py-3">Source</th>}
                </tr>
              </thead>
              <tbody>
                {filteredParties.map((party, index) => {
                  const pairId = getPairId(selectedParty, party.id);
                  const relationship = getEffectiveRelationship(pairId);
                  const overridden = scope === "state" && hasStateOverride(pairId);
                  return (
                    <tr key={pairId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                      <td className="px-4 py-3 font-semibold">{selectedParty}</td>
                      <td className="px-4 py-3 font-semibold">{party.id}</td>
                      <td className="px-4 py-3">
                        <select value={relationship} onChange={(e) => updateRelationship(pairId, e.target.value as Relationship)} className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800" style={{ colorScheme: "light dark" }}>
                          {relationships.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </td>
                      {scope === "state" && (
                        <td className="px-4 py-3">
                          {overridden ? <span className="text-xs font-medium text-orange-600 dark:text-orange-400">State override</span> : <span className="text-xs text-slate-500">National default</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredParties.length === 0 && (
                  <tr><td colSpan={scope === "state" ? 5 : 4} className="px-4 py-10 text-center text-slate-500">No matching parties found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-sm text-slate-500">
          Changes are automatically saved in this browser. Each party pair is stored only once, so the relationship appears identically whichever party you select. State-specific values override national values; otherwise, the national relationship is inherited.
        </p>
      </div>
    </main>
  );
}
