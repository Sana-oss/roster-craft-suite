import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Unlock, Hotel, Plus, Trash2, LogOut, Save, Calendar, Phone, ChevronLeft, ChevronRight, KeyRound, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

type Category = "Fo Supervisors" | "Fo Shiftleader" | "Reception" | "Concierge" | "Bell Boy";
const CATEGORIES: Category[] = ["Fo Supervisors", "Fo Shiftleader", "Reception", "Concierge", "Bell Boy"];

type ShiftCode = string;


const SHIFT_OPTIONS: { code: ShiftCode; label: string; hours?: string }[] = [
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
  shiftColors: Record<number, "M" | "A" | "N" | "MID">;
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

const DEFAULT_PASSWORD = "admin123";
const STORAGE_KEY = "hotel_roster_v1";
const PASSWORD_STORAGE_KEY = "admin_custom_password";

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
    shiftColors: {},
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
      try {
        const parsed = JSON.parse(raw) as RosterState;
        parsed.employees = parsed.employees.map(e => ({
          shifts: {},
          shiftColors: {},
          ...e,
        }));
        return parsed;
      } catch {}
    }
  }
  return {
    weekStart: "2026-01-03", // stable placeholder; replaced on client mount
    employees: seedEmployees(),
    departures: {},
    arrivals: {},
  };
}

function shiftClasses(code: ShiftCode, color?: "M" | "A" | "N" | "MID"): string {
  if (code === "DO") return "bg-zinc-200 text-zinc-600 border-zinc-300";
  if (code === "PL") return "bg-zinc-700 text-white border-zinc-800";
  if (color) {
    switch (color) {
      case "M": return "bg-amber-100 text-amber-900 border-amber-200";
      case "A": return "bg-orange-100 text-orange-900 border-orange-200";
      case "N": return "bg-indigo-100 text-indigo-900 border-indigo-200";
      case "MID": return "bg-emerald-100 text-emerald-900 border-emerald-200";
    }
  }
  return code ? "bg-white text-slate-800 border-slate-300" : "bg-white text-zinc-400 border-zinc-200";
}

function shiftLabel(code: ShiftCode): string {
  if (!code) return "—";
  return code;
}

function AdminShiftCell({ code, color, onUpdate }: {
  code: ShiftCode;
  color?: "M" | "A" | "N" | "MID";
  onUpdate: (code: ShiftCode, color?: "M" | "A" | "N" | "MID") => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [selectedColor, setSelectedColor] = useState<"M" | "A" | "N" | "MID" | undefined>(undefined);

  useEffect(() => {
    if (open) {
      const isCustom = code && code !== "DO" && code !== "PL";
      setInputVal(isCustom ? code : "");
      setSelectedColor(isCustom ? color : undefined);
    }
  }, [open, code, color]);

  const isDOorPL = code === "DO" || code === "PL";
  const showLabel = color ? "" : (code || "—");

  const colorDefs = [
    { key: "M" as const, time: "07:00-15:30", classes: "bg-amber-400 hover:bg-amber-500", label: "Amber" },
    { key: "A" as const, time: "15:00-23:30", classes: "bg-orange-400 hover:bg-orange-500", label: "Orange" },
    { key: "N" as const, time: "23:00-07:30", classes: "bg-indigo-400 hover:bg-indigo-500", label: "Indigo" },
    { key: "MID" as const, time: "10:00-18:30", classes: "bg-emerald-400 hover:bg-emerald-500", label: "Emerald" },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className={`w-full px-2 py-1.5 rounded-md border text-xs font-semibold text-center transition cursor-pointer hover:ring-2 hover:ring-amber-300 ${shiftClasses(code, color)}`}>
          {code || "—"}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="center">
        <div className="space-y-2">
          <Input
            placeholder="e.g. 08:00-16:00"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && inputVal.trim() && (onUpdate(inputVal.trim(), selectedColor) || setOpen(false))}
            autoFocus
            className="h-8 text-sm"
          />
          <div className="flex items-center gap-1.5 justify-center">
            {colorDefs.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => { setSelectedColor(c.key); setInputVal(c.time); }}
                className={`w-7 h-7 rounded-full border-2 transition ${c.classes} ${selectedColor === c.key ? "border-slate-900 ring-2 ring-offset-1 ring-slate-400" : "border-transparent"}`}
                title={c.label}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => { onUpdate("DO", undefined); setOpen(false); }}>DO</Button>
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => { onUpdate("PL", undefined); setOpen(false); }}>PL</Button>
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => { onUpdate("", undefined); setOpen(false); }}>Clear</Button>
          </div>
          {inputVal.trim() && (
            <Button size="sm" className="w-full h-8 text-xs" onClick={() => { onUpdate(inputVal.trim(), selectedColor); setOpen(false); }}>
              Apply
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LoadingState() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-zinc-100 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900" />
        <p className="text-sm text-slate-500">Loading roster…</p>
      </div>
    </div>
  );
}

export function RosterApp() {
  const [state, setState] = useState<RosterState>({
    weekStart: iso(startOfSaturday(new Date())),
    employees: [],
    departures: {},
    arrivals: {},
  });
  const [loaded, setLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newEmp, setNewEmp] = useState<{ name: string; category: Category; mobile: string }>({
    name: "", category: "Reception", mobile: "",
  });
  const fromSyncRef = useRef(false);
  const mountedRef = useRef(false);
  const adminPasswordRef = useRef(
    (typeof window !== "undefined" ? localStorage.getItem(PASSWORD_STORAGE_KEY) : null)
    || import.meta.env.VITE_ADMIN_PASSWORD
    || DEFAULT_PASSWORD
  );

  // Mount: fetch from Supabase first (authoritative), fall back to localStorage
  useEffect(() => {
    const ws = iso(startOfSaturday(new Date()));
    let cancelled = false;

    const fetchSupabase = supabase
      .from("rosters")
      .select("*")
      .eq("week_start", ws)
      .maybeSingle()
      .then(({ data }) => data);

    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 5000)
    );

    const fromLocalStorage = (): RosterState | null => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as RosterState;
        parsed.employees = parsed.employees.map(e => ({ shifts: {}, shiftColors: {}, ...e }));
        return parsed;
      } catch { return null; }
    };

    Promise.race([fetchSupabase, timeout])
      .then((data) => {
        if (cancelled) return;
        if (data) {
          // Supabase is authoritative
          const remote: RosterState = {
            weekStart: data.week_start,
            employees: (data.employees ?? []) as Employee[],
            departures: (data.departures ?? {}) as Record<number, number>,
            arrivals: (data.arrivals ?? {}) as Record<number, number>,
          };
          setState(remote);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
          return;
        }
        // No data from Supabase — fall back to localStorage
        const local = fromLocalStorage();
        if (local) {
          setState(local);
          supabase.from("rosters").upsert(
            { week_start: ws, employees: local.employees, departures: local.departures, arrivals: local.arrivals },
            { onConflict: "week_start" }
          ).then(undefined, e => toast.error("Seed sync error: " + (e as Error).message));
        } else {
          const seed: RosterState = { weekStart: ws, employees: seedEmployees(), departures: {}, arrivals: {} };
          setState(seed);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
          supabase.from("rosters").upsert(
            { week_start: ws, employees: seed.employees, departures: seed.departures, arrivals: seed.arrivals },
            { onConflict: "week_start" }
          ).then(undefined, e => toast.error("Seed sync error: " + (e as Error).message));
        }
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Sync unavailable, using local data");
        const local = fromLocalStorage();
        if (local) {
          setState(local);
        } else {
          setState({ weekStart: ws, employees: seedEmployees(), departures: {}, arrivals: {} });
        }
      })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
  }, []);

  // Sync admin password from Supabase (shared across devices)
  useEffect(() => {
    supabase
      .from("admin_config")
      .select("password")
      .eq("id", "main")
      .single()
      .then(({ data }) => {
        if (data?.password) {
          adminPasswordRef.current = data.password;
          localStorage.setItem(PASSWORD_STORAGE_KEY, data.password);
        }
      })
      .catch(() => {});
  }, []);

  // Keep localStorage as offline fallback
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, loaded]);

  // Fetch from Supabase when navigating weeks (skip initial mount)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    let cancelled = false;
      supabase
        .from("rosters")
        .select("*")
        .eq("week_start", state.weekStart)
        .single()
        .then(({ data }) => {
          if (cancelled || !data) return;
          setState(prev => {
            if (prev.weekStart !== state.weekStart) return prev;
            return {
              weekStart: data.week_start,
              employees: (data.employees ?? []) as Employee[],
              departures: (data.departures ?? {}) as Record<number, number>,
              arrivals: (data.arrivals ?? {}) as Record<number, number>,
            };
          });
        }, e => toast.error("Week fetch error: " + (e as Error).message));
    return () => { cancelled = true; };
  }, [state.weekStart]);

  // Save to Supabase on state change
  useEffect(() => {
    if (!loaded) return;
    if (fromSyncRef.current) {
      fromSyncRef.current = false;
      return;
    }
    supabase.from("rosters").upsert(
      {
        week_start: state.weekStart,
        employees: state.employees,
        departures: state.departures,
        arrivals: state.arrivals,
      },
      { onConflict: "week_start" }
    ).then(undefined, e => toast.error("Save error: " + (e as Error).message));
  }, [state, loaded]);

  // Realtime subscription for cross-device sync
  useEffect(() => {
    const ws = state.weekStart;
    const channel = supabase
      .channel(`roster-${ws}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rosters",
          filter: `week_start=eq.${ws}`,
        },
        (payload) => {
          const row = payload.new as any;
          setState(prev => {
            const same =
              JSON.stringify(row.employees) === JSON.stringify(prev.employees) &&
              JSON.stringify(row.departures) === JSON.stringify(prev.departures) &&
              JSON.stringify(row.arrivals) === JSON.stringify(prev.arrivals);
            if (same) return prev;
            fromSyncRef.current = true;
            return {
              weekStart: row.week_start,
              employees: row.employees ?? [],
              departures: row.departures ?? {},
              arrivals: row.arrivals ?? {},
            };
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [state.weekStart]);

  // Broadcast channel: applies imported roster data directly on other devices
  useEffect(() => {
    const ws = state.weekStart;
    const channel = supabase
      .channel("roster-sync")
      .on("broadcast", { event: "import" }, (payload) => {
        const d = payload.payload as RosterState;
        if (d.weekStart !== ws) return;
        setState(prev => {
          const same =
            JSON.stringify(d.employees) === JSON.stringify(prev.employees) &&
            JSON.stringify(d.departures) === JSON.stringify(prev.departures) &&
            JSON.stringify(d.arrivals) === JSON.stringify(prev.arrivals);
          if (same) return prev;
          fromSyncRef.current = true;
          return { weekStart: d.weekStart, employees: d.employees, departures: d.departures, arrivals: d.arrivals };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [state.weekStart]);

  // Polling fallback: check DB every 5s for changes from other devices
  useEffect(() => {
    const ws = state.weekStart;
    if (!ws) return;
    const poll = setInterval(async () => {
      const { error, data } = await supabase
        .from("rosters")
        .select("employees,departures,arrivals")
        .eq("week_start", ws)
        .maybeSingle();
      if (error) { console.warn("Poll error", ws, error); return; }
      if (!data) { console.log("Poll - no data for", ws); return; }
      setState(prev => {
        const same =
          JSON.stringify(data.employees) === JSON.stringify(prev.employees) &&
          JSON.stringify(data.departures) === JSON.stringify(prev.departures) &&
          JSON.stringify(data.arrivals) === JSON.stringify(prev.arrivals);
        if (same) { console.log("Poll - same data, no update"); return prev; }
        console.log("Poll - found different data, applying", data.employees?.length, "employees");
        fromSyncRef.current = true;
        return { ...prev, employees: data.employees ?? [], departures: data.departures ?? {}, arrivals: data.arrivals ?? {} };
      });
    }, 5000);
    return () => clearInterval(poll);
  }, [state.weekStart]);

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
    if (password === adminPasswordRef.current) {
      setIsAdmin(true);
      setLoginOpen(false);
      setPassword("");
      toast.success("Admin mode enabled");
    } else {
      toast.error("Incorrect password");
    }
  }

  function changePassword() {
    if (!newPassword.trim()) { toast.error("Password cannot be empty"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    adminPasswordRef.current = newPassword;
    localStorage.setItem(PASSWORD_STORAGE_KEY, newPassword);
    supabase
      .from("admin_config")
      .upsert({ id: "main", password: newPassword }, { onConflict: "id" })
      .then(undefined, e => toast.error("Sync error: " + (e as Error).message));
    setChangePwOpen(false);
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Admin password updated across all devices");
  }

  function updateShift(empId: string, dayIdx: number, code: ShiftCode, color?: "M" | "A" | "N" | "MID") {
    setState(s => ({
      ...s,
      employees: s.employees.map(e =>
        e.id === empId ? {
          ...e,
          shifts: { ...e.shifts, [dayIdx]: code },
          shiftColors: color
            ? { ...e.shiftColors, [dayIdx]: color }
            : (() => { const c = { ...e.shiftColors }; delete c[dayIdx]; return c; })(),
        } : e
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
      shifts: {}, shiftColors: {}, plRemaining: 14, dlExtra: 0, doRemaining: 4,
    };
    setState(s => ({ ...s, employees: [...s.employees, emp] }));
    setNewEmp({ name: "", category: "Reception", mobile: "" });
    setAddOpen(false);
    toast.success("Employee added");
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hotel-roster-${state.weekStart}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup downloaded");
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as RosterState;
        if (!parsed.weekStart || !Array.isArray(parsed.employees)) {
          toast.error("Invalid backup file");
          return;
        }
        supabase.from("rosters").upsert(
          {
            week_start: parsed.weekStart,
            employees: parsed.employees,
            departures: parsed.departures,
            arrivals: parsed.arrivals,
          },
          { onConflict: "week_start" }
        ).then(({ error }) => {
          if (error) { console.error("Import upsert error", error); toast.error("Save failed: " + error.message); return; }
          console.log("Import upsert OK for", parsed.weekStart, "emps:", parsed.employees.length);
          setState(parsed);
          const b = parsed;
          const ch = supabase.channel("roster-sync");
          ch.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              ch.send({ type: "broadcast", event: "import", payload: b });
            }
          });
          toast.success("Backup restored");
        });
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function shiftWeek(delta: number) {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() + delta * 7);
    setState(s => ({ ...s, weekStart: iso(d), departures: {}, arrivals: {} }));
  }

  function goToDate(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return;
    setState(s => ({ ...s, weekStart: iso(startOfSaturday(d)), departures: {}, arrivals: {} }));
  }

  if (!loaded) return <LoadingState />;
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-zinc-100 text-slate-900">
      <Toaster richColors position="top-right" />
      <style>{`
        @media print {
          @page { size: landscape; margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .roster-table { overflow: visible !important; }
          .roster-table > div { overflow: visible !important; }
          .roster-table table { table-layout: fixed; width: 100%; min-width: 0; }
          .roster-table tr { page-break-inside: avoid; }
          .roster-table { border: none !important; box-shadow: none !important; border-radius: 0 !important; }
          .roster-table th,
          .roster-table td { padding: 3px 4px !important; font-size: 8px !important; white-space: nowrap; }
          .roster-table td input { font-size: 8px !important; padding: 1px 3px !important; height: auto !important; }
          .roster-table td div { font-size: 8px !important; padding: 1px 4px !important; }
          .roster-table th div { font-size: 7px !important; }
        }
      `}</style>
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20 print:hidden">
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
            <div className="hidden sm:flex items-center gap-1 rounded-lg border border-slate-200 bg-white print:hidden">
              {isAdmin && <button onClick={() => shiftWeek(-1)} className="px-2 py-1.5 hover:bg-slate-50 rounded-l-lg" aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </button>}
              <div className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border-x border-slate-200">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                {isAdmin ? (
                  <input type="date" value={state.weekStart}
                    onChange={e => goToDate(e.target.value)}
                    className="w-36 bg-transparent text-sm font-semibold outline-none cursor-pointer" />
                ) : (
                  <>{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</>
                )}
              </div>
              {isAdmin && <button onClick={() => shiftWeek(1)} className="px-2 py-1.5 hover:bg-slate-50 rounded-r-lg" aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </button>}
            </div>
            <Button onClick={() => window.print()} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-sm gap-1.5">
              <Printer className="h-4 w-4" /> Print
            </Button>
            {isAdmin ? (
              <>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Unlock className="h-3 w-3" /> Admin
                </span>
                <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
                <Button variant="outline" size="sm" onClick={handleExport}><Save className="h-4 w-4 mr-1.5" /> Export</Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Save className="h-4 w-4 mr-1.5" /> Import</Button>
                <Dialog open={changePwOpen} onOpenChange={setChangePwOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm"><KeyRound className="h-4 w-4 mr-1.5" /> Change password</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader><DialogTitle>Change admin password</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <Label htmlFor="newPw">New password</Label>
                      <Input id="newPw" type="password" value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="Enter new password" autoFocus />
                      <Label htmlFor="confirmPw">Confirm new password</Label>
                      <Input id="confirmPw" type="password" value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && changePassword()}
                        placeholder="Confirm new password" />
                    </div>
                    <DialogFooter>
                      <Button onClick={changePassword} className="w-full">Save password</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
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
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap gap-2 text-xs">
            {SHIFT_OPTIONS.filter(s => s.code !== "").map(s => (
              <span key={s.code} className={`px-2.5 py-1 rounded-md border font-medium ${shiftClasses(s.code)}`}>
                {s.code}: {s.label}
              </span>
            ))}
            <span className="px-2.5 py-1 rounded-md border font-medium bg-amber-100 text-amber-900 border-amber-200">M 07:00-15:30</span>
            <span className="px-2.5 py-1 rounded-md border font-medium bg-orange-100 text-orange-900 border-orange-200">A 15:00-23:30</span>
            <span className="px-2.5 py-1 rounded-md border font-medium bg-indigo-100 text-indigo-900 border-indigo-200">N 23:00-07:30</span>
            <span className="px-2.5 py-1 rounded-md border font-medium bg-emerald-100 text-emerald-900 border-emerald-200">MID 10:00-18:30</span>
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
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden roster-table">
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
                          const theCode = emp.shifts?.[i] ?? "";
                          const theColor = emp.shiftColors?.[i];
                          return (
                            <td key={i} className="px-1.5 py-1.5">
                              {isAdmin ? (
                                <AdminShiftCell code={theCode} color={theColor} onUpdate={(c, cl) => updateShift(emp.id, i, c, cl)} />
                              ) : (
                                <div className={`w-full px-2 py-1.5 rounded-md border text-xs font-semibold text-center transition ${shiftClasses(theCode, theColor)}`}>
                                  {theCode || "—"}
                                </div>
                              )}
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

        <p className="text-center text-xs text-slate-400 print:hidden">
          Changes sync across devices automatically.
        </p>
      </main>
    </div>
  );
}