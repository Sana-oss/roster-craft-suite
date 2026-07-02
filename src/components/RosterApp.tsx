import { Fragment, useEffect, useMemo, useState } from "react";
import { Lock, Unlock, Hotel, Plus, Trash2, LogOut, Save, Calendar, Phone, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

type Category = "Fo Supervisors" | "Fo Shiftleader" | "Reception" | "Concierge" | "Bell Boy";
const CATEGORIES: Category[] = ["Fo Supervisors", "Fo Shiftleader", "Reception", "Concierge", "Bell Boy"];

type ShiftCode = "M" | "A" | "N" | "MID" | "DO" | "PL" | "";
const CLEAR_VALUE = "CLEAR";
const NONE_VALUE = "NONE";
const SHIFT_OPTIONS: { code: ShiftCode; label: string; hours: string }[] = [
  { code: "M", label: "Morning", hours: "07:00-15:30" },
  { code: "A", label: "Afternoon", hours: "15:00-23:30" },
  { code: "N", label: "Night", hours: "23:00-07:30" },
  { code: "MID", label: "Mid-Shift", hours: "12:00-20:30" },
  { code: "DO", label: "Day Off", hours: "" },
  { code: "PL", label: "Paid Leave", hours: "" },
  { code: "", label: "Clear", hours: "" },
];

interface Employee {
  id: string;
  name: string;
  category: Category;
  mobile: string;
  shifts: Record<number, ShiftCode>; // 0..6
  plRemaining: number;
  dlExtra: number;
  doRemaining: number;
}

interface RosterState {
  weekStart: string; // ISO date of Saturday
  employees: Employee[];
  departures: Record<number, number>;
  arrivals: Record<number, number>;
}

const ADMIN_PASSWORD = "admin123";
const STORAGE_KEY = "hotel_roster_v1";

function startOfSaturday(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0 Sun..6 Sat
  const diff = (day - 6 + 7) % 7;
  date.setDate(date.getDate() - diff);
  return date;
}

function fmtDay(d: Date) {
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}
function fmtDate(d: Date) {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function seedEmployees(): Employee[] {
  const mk = (name: string, category: Category, mobile: string, pl = 14, dl = 0, doR = 4): Employee => ({
    id: crypto.randomUUID().slice(0, 8).toUpperCase(),
    name,
    category,
    mobile,
    shifts: {},
    plRemaining: pl,
    dlExtra: dl,
    doRemaining: doR,
  });
  return [
    mk("Ahmed Hassan", "Fo Supervisors", "+20 100 111 2233"),
    mk("Sara El-Sayed", "Fo Supervisors", "+20 100 222 3344"),
    mk("Karim Nabil", "Fo Shiftleader", "+20 101 333 4455"),
    mk("Mona Adel", "Fo Shiftleader", "+20 101 444 5566"),
    mk("Youssef Ibrahim", "Reception", "+20 102 555 6677"),
    mk("Laila Fathy", "Reception", "+20 102 666 7788"),
    mk("Omar Zaki", "Reception", "+20 102 777 8899"),
    mk("Hana Mostafa", "Concierge", "+20 103 888 9900"),
    mk("Tarek Salah", "Concierge", "+20 103 999 0011"),
    mk("Mahmoud Ali", "Bell Boy", "+20 104 121 3344"),
    mk("Islam Farid", "Bell Boy", "+20 104 232 4455"),
  ];
}

function loadState(): RosterState {
  if (typeof window !== "undefined") {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { return JSON.parse(raw) as RosterState; } catch {}
    }
  }
  return {
    weekStart: "2026-01-03", // stable placeholder; replaced on client mount
    employees: seedEmployees(),
    departures: {},
    arrivals: {},
  };
}

function shiftClasses(code: ShiftCode): string {
  switch (code) {
    case "M": return "bg-amber-100 text-amber-900 border-amber-200";
    case "A": return "bg-orange-100 text-orange-900 border-orange-200";
    case "N": return "bg-indigo-100 text-indigo-900 border-indigo-200";
    case "MID": return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "DO": return "bg-zinc-200 text-zinc-600 border-zinc-300";
    case "PL": return "bg-zinc-700 text-white border-zinc-800";
    default: return "bg-white text-zinc-400 border-zinc-200";
  }
}

function shiftLabel(code: ShiftCode): string {
  const found = SHIFT_OPTIONS.find(s => s.code === code);
  if (!found || code === "") return "—";
  if (code === "DO" || code === "PL") return code;
  return found.hours;
}

export function RosterApp() {
  const [state, setState] = useState<RosterState>(() => loadState());
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newEmp, setNewEmp] = useState<{ name: string; category: Category; mobile: string }>({
    name: "", category: "Reception", mobile: "",
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Set the real current week on the client only, to avoid SSR hydration mismatch.
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return; // user already has a saved week
    setState(s => ({ ...s, weekStart: iso(startOfSaturday(new Date())) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weekDates = useMemo(() => {
    const start = new Date(state.weekStart);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [state.weekStart]);

  const grouped = useMemo(() => {
    const map: Record<Category, Employee[]> = {
      "Fo Supervisors": [], "Fo Shiftleader": [], "Reception": [], "Concierge": [], "Bell Boy": [],
    };
    state.employees.forEach(e => map[e.category].push(e));
    return map;
  }, [state.employees]);

  function tryLogin() {
    if (password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      setLoginOpen(false);
      setPassword("");
      toast.success("Admin mode enabled");
    } else {
      toast.error("Incorrect password");
    }
  }

  function updateShift(empId: string, dayIdx: number, code: ShiftCode) {
    setState(s => ({
      ...s,
      employees: s.employees.map(e =>
        e.id === empId ? { ...e, shifts: { ...e.shifts, [dayIdx]: code } } : e
      ),
    }));
  }

  function updateMetric(empId: string, field: "plRemaining" | "dlExtra" | "doRemaining", value: number) {
    setState(s => ({
      ...s,
      employees: s.employees.map(e => e.id === empId ? { ...e, [field]: value } : e),
    }));
  }

  function updateEmpField(empId: string, field: "name" | "mobile", value: string) {
    setState(s => ({
      ...s,
      employees: s.employees.map(e => e.id === empId ? { ...e, [field]: value } : e),
    }));
  }

  function removeEmp(empId: string) {
    setState(s => ({ ...s, employees: s.employees.filter(e => e.id !== empId) }));
    toast.success("Employee removed");
  }

  function addEmployee() {
    if (!newEmp.name.trim()) { toast.error("Name required"); return; }
    const emp: Employee = {
      id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      name: newEmp.name.trim(),
      category: newEmp.category,
      mobile: newEmp.mobile,
      shifts: {}, plRemaining: 14, dlExtra: 0, doRemaining: 4,
    };
    setState(s => ({ ...s, employees: [...s.employees, emp] }));
    setNewEmp({ name: "", category: "Reception", mobile: "" });
    setAddOpen(false);
    toast.success("Employee added");
  }

  function shiftWeek(delta: number) {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() + delta * 7);
    setState(s => ({ ...s, weekStart: iso(d), departures: {}, arrivals: {} }));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-zinc-100 text-slate-900">
      <Toaster richColors position="top-right" />
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-xl bg-slate-900 text-amber-300 grid place-items-center shrink-0">
              <Hotel className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate">Front Office Roster</h1>
              <p className="text-xs text-slate-500">Weekly shift schedule · Hotel operations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 rounded-lg border border-slate-200 bg-white">
              <button onClick={() => shiftWeek(-1)} className="px-2 py-1.5 hover:bg-slate-50 rounded-l-lg" aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border-x border-slate-200">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                {fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}
              </div>
              <button onClick={() => shiftWeek(1)} className="px-2 py-1.5 hover:bg-slate-50 rounded-r-lg" aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {isAdmin ? (
              <>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Unlock className="h-3 w-3" /> Admin
                </span>
                <Button variant="outline" size="sm" onClick={() => { setIsAdmin(false); toast.message("Switched to view mode"); }}>
                  <LogOut className="h-4 w-4 mr-1.5" /> Exit admin
                </Button>
              </>
            ) : (
              <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
                    <Lock className="h-4 w-4 mr-1.5" /> Admin login
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Admin access</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Label htmlFor="pw">Password</Label>
                    <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && tryLogin()} placeholder="Enter admin password" autoFocus />
                    <p className="text-xs text-slate-500">Demo password: <code className="px-1 py-0.5 rounded bg-slate-100">admin123</code></p>
                  </div>
                  <DialogFooter>
                    <Button onClick={tryLogin} className="w-full">Unlock</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6 space-y-6">
        {/* Legend + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {SHIFT_OPTIONS.filter(s => s.code !== "").map(s => (
              <span key={s.code} className={`px-2.5 py-1 rounded-md border font-medium ${shiftClasses(s.code)}`}>
                {s.code}: {s.label}{s.hours && ` (${s.hours})`}
              </span>
            ))}
          </div>
          {isAdmin && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1.5" /> Add employee</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>New employee</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={newEmp.name} onChange={e => setNewEmp(v => ({ ...v, name: e.target.value }))} /></div>
                  <div><Label>Category</Label>
                    <Select value={newEmp.category} onValueChange={(v) => setNewEmp(x => ({ ...x, category: v as Category }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Mobile</Label><Input value={newEmp.mobile} onChange={e => setNewEmp(v => ({ ...v, mobile: e.target.value }))} /></div>
                </div>
                <DialogFooter><Button onClick={addEmployee}><Save className="h-4 w-4 mr-1.5" />Add</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-slate-900 text-white text-xs uppercase tracking-wide">
                  <th className="px-3 py-3 text-left font-semibold sticky left-0 bg-slate-900 z-10">Employee</th>
                  <th className="px-2 py-3 text-left font-semibold">ID</th>
                  {weekDates.map((d, i) => (
                    <th key={i} className="px-2 py-3 text-center font-semibold">
                      <div>{fmtDay(d)}</div>
                      <div className="text-[10px] text-slate-300 font-normal">{fmtDate(d)}</div>
                    </th>
                  ))}
                  <th className="px-2 py-3 text-center font-semibold">PL Rem.</th>
                  <th className="px-2 py-3 text-center font-semibold">DL (extra)</th>
                  <th className="px-2 py-3 text-center font-semibold">DO Rem.</th>
                  <th className="px-2 py-3 text-left font-semibold">Mobile</th>
                  {isAdmin && <th className="px-2 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map(cat => (
                  <Fragment key={cat}>
                    <tr>
                      <td colSpan={12 + (isAdmin ? 1 : 0)} className="px-3 py-2 bg-gradient-to-r from-amber-50 to-transparent border-y border-amber-200/60 text-xs font-bold uppercase tracking-widest text-amber-900">
                        {cat}
                      </td>
                    </tr>
                    {grouped[cat].length === 0 && (
                      <tr><td colSpan={12 + (isAdmin ? 1 : 0)} className="px-4 py-3 text-xs text-slate-400 italic">No employees in this category.</td></tr>
                    )}
                    {grouped[cat].map(emp => (
                      <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-2 sticky left-0 bg-white group-hover:bg-slate-50/60">
                          {isAdmin ? (
                            <Input value={emp.name} onChange={e => updateEmpField(emp.id, "name", e.target.value)}
                              className="h-8 text-sm font-medium" />
                          ) : (
                            <span className="font-medium">{emp.name}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs text-slate-500 font-mono">{emp.id}</td>
                        {weekDates.map((_, i) => {
                          const code = emp.shifts[i] ?? "";
                          const cell = (
                            <div className={`w-full px-2 py-1.5 rounded-md border text-xs font-semibold text-center transition ${shiftClasses(code)} ${isAdmin ? "cursor-pointer hover:ring-2 hover:ring-amber-300" : ""}`}
                              title={shiftLabel(code)}>
                              {code || "—"}
                            </div>
                          );
                          return (
                            <td key={i} className="px-1.5 py-1.5">
                              {isAdmin ? (
                                <Select
                                  value={code === "" ? NONE_VALUE : code}
                                  onValueChange={(v) =>
                                    updateShift(emp.id, i, (v === CLEAR_VALUE || v === NONE_VALUE ? "" : v) as ShiftCode)
                                  }
                                >
                                  <SelectTrigger className="p-0 border-0 shadow-none bg-transparent h-auto focus:ring-0 [&>svg]:hidden w-full">
                                    {cell}
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SHIFT_OPTIONS.map(o => {
                                      const val = o.code === "" ? CLEAR_VALUE : o.code;
                                      return (
                                        <SelectItem key={val} value={val}>
                                          <span className="font-semibold mr-2">{o.code || "—"}</span>
                                          <span className="text-slate-500 text-xs">{o.label}{o.hours && ` · ${o.hours}`}</span>
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              ) : cell}
                            </td>
                          );
                        })}
                        {(["plRemaining", "dlExtra", "doRemaining"] as const).map(field => (
                          <td key={field} className="px-2 py-2 text-center">
                            {isAdmin ? (
                              <Input type="number" value={emp[field]} onChange={e => updateMetric(emp.id, field, Number(e.target.value))}
                                className="h-8 w-16 mx-auto text-center text-sm" />
                            ) : (
                              <span className="tabular-nums font-medium">{emp[field]}</span>
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-xs text-slate-600">
                          {isAdmin ? (
                            <Input value={emp.mobile} onChange={e => updateEmpField(emp.id, "mobile", e.target.value)} className="h-8 text-xs" />
                          ) : (
                            <span className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400" />{emp.mobile}</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-2">
                            <button onClick={() => removeEmp(emp.id)} className="p-1.5 rounded-md hover:bg-red-50 text-red-600" aria-label="Remove">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                ))}

                {/* Summary rows */}
                {(["arrivals", "departures"] as const).map(kind => (
                  <tr key={kind} className="bg-slate-50 border-t-2 border-slate-300">
                    <td className="px-3 py-3 font-bold uppercase text-xs tracking-widest text-slate-700 sticky left-0 bg-slate-50">
                      {kind === "arrivals" ? "Arrivals" : "Departures"}
                    </td>
                    <td></td>
                    {weekDates.map((_, i) => {
                      const val = state[kind][i] ?? 0;
                      return (
                        <td key={i} className="px-1.5 py-2 text-center">
                          {isAdmin ? (
                            <Input type="number" value={val}
                              onChange={e => setState(s => ({ ...s, [kind]: { ...s[kind], [i]: Number(e.target.value) } }))}
                              className="h-8 w-16 mx-auto text-center text-sm font-semibold" />
                          ) : (
                            <span className="inline-block min-w-[2rem] font-bold tabular-nums text-slate-800">{val}</span>
                          )}
                        </td>
                      );
                    })}
                    <td colSpan={4 + (isAdmin ? 1 : 0)} className="px-3 py-2 text-xs text-slate-500">
                      Total: <span className="font-bold text-slate-800">{weekDates.reduce((a, _, i) => a + (state[kind][i] ?? 0), 0)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">
          {isAdmin ? "Admin mode · all edits save to your browser." : "View-only mode · sign in as admin to edit."}
        </p>
      </main>
    </div>
  );
}