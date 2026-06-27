import { useState, useCallback } from "react";
import Papa from "papaparse";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line, Area, AreaChart, LabelList
} from "recharts";

const GW_COLORS  = { METROBANK:"#1a56db", PINBASED:"#e3a008", INAPP:"#0e9f6e" };
const GW_LABELS  = { METROBANK:"Metrobank", PINBASED:"PIN-Based", INAPP:"In-App" };
const COUNTRY_COLORS = ["#1a56db","#0e9f6e","#e3a008","#e02424","#7c3aed","#0891b2","#f97316","#64748b","#ec4899","#14b8a6"];
const COUNTRY_NAMES  = {
  PH:"🇵🇭 Philippines", IN:"🇮🇳 India", CN:"🇨🇳 China",
  US:"🇺🇸 USA", AU:"🇦🇺 Australia", SA:"🇸🇦 Saudi Arabia",
  AE:"🇦🇪 UAE", GB:"🇬🇧 UK", HK:"🇭🇰 Hong Kong",
  SG:"🇸🇬 Singapore", NZ:"🇳🇿 New Zealand", MY:"🇲🇾 Malaysia",
  CO:"🇨🇴 Colombia", IE:"🇮🇪 Ireland", CH:"🇨🇭 Switzerland",
  NG:"🇳🇬 Nigeria", JP:"🇯🇵 Japan", TH:"🇹🇭 Thailand",
  BR:"🇧🇷 Brazil", ID:"🇮🇩 Indonesia", QA:"🇶🇦 Qatar",
  TW:"🇹🇼 Taiwan", ES:"🇪🇸 Spain", KW:"🇰🇼 Kuwait",
  Unknown:"🌐 Unknown"
};
const STATUS_COLORS = { ACTIVE:"#0e9f6e", VERIFY:"#e3a008", SUSPENDED:"#e02424" };

// ── Process Data ─────────────────────────────────────────────────────────────
function processData(payRows, subRows) {
  // Build subscriber maps
  const countryMap = {}, nameMap = {}, statusMap = {};
  subRows.forEach(r => {
    if (!r.initiatedby) return;
    countryMap[r.initiatedby] = r.subscribercountry || "PH"; // No country = PH (platform only allows PH numbers)
    nameMap[r.initiatedby]    = r.subscribername || "";
    statusMap[r.initiatedby]  = r.subscriberstatus || "Unknown";
  });

  // SUCCESS payments only
  const success = payRows
    .filter(r => (r.transactionstatus||"").toUpperCase() === "SUCCESS")
    .map(r => ({ ...r, _date: new Date(r.created) }))
    .sort((a, b) => a._date - b._date);

  // Renewal logic: New = first ever, Renewal = any subsequent
  const firstSeen = {};
  success.forEach(r => {
    const uid = r.initiatedby;
    r.month_key = r._date.toISOString().slice(0,7);
    r.month     = r._date.toLocaleString("default",{month:"short",year:"numeric"});
    r.country   = countryMap[uid] || "PH"; // Platform only allows PH numbers - unmatched = PH
    r.sub_name  = nameMap[uid] || "";
    r.sub_status= statusMap[uid] || "Unknown";
    if (!firstSeen[uid]) { firstSeen[uid] = r.month_key; r.type = "New"; }
    else r.type = "Renewal";
  });

  const paying_ids = new Set(success.map(r => r.initiatedby));
  const dateFrom   = new Date("2025-06-19");
  const payDates   = success.map(r => r._date.getTime());
  const subDates   = subRows.map(r => r.created ? new Date(r.created).getTime() : 0).filter(Boolean);
  const dateTo     = [...payDates,...subDates].length ? new Date(Math.max(...payDates,...subDates)) : new Date();

  // ── Monthly subscriber growth ──
  // Platform go-live = July 2025. Exclude pre-launch months from charts.
  const GO_LIVE_MONTH = "2025-07";
  const subMonthMapAll = {};
  subRows.forEach(r => {
    if (!r.created) return;
    const d  = new Date(r.created);
    const mk = d.toISOString().slice(0,7);
    const mo = d.toLocaleString("default",{month:"short",year:"numeric"});
    const cc = r.subscribercountry || "PH"; // empty = PH
    const st = r.subscriberstatus || "UNKNOWN";
    const isActive   = st === "ACTIVE";
    const isInactive = st === "VERIFY" || st === "SUSPENDED";

    if (!subMonthMapAll[mk]) subMonthMapAll[mk] = { month_key:mk, month:mo };

    // Per country counts
    subMonthMapAll[mk][`${cc}__ACTIVE`]   = (subMonthMapAll[mk][`${cc}__ACTIVE`]   || 0) + (isActive ? 1 : 0);
    subMonthMapAll[mk][`${cc}__INACTIVE`] = (subMonthMapAll[mk][`${cc}__INACTIVE`] || 0) + (isInactive ? 1 : 0);
    subMonthMapAll[mk][`${cc}__TOTAL`]    = (subMonthMapAll[mk][`${cc}__TOTAL`]    || 0) + 1;

    // ALL countries counts
    subMonthMapAll[mk]['ALL__ACTIVE']   = (subMonthMapAll[mk]['ALL__ACTIVE']   || 0) + (isActive ? 1 : 0);
    subMonthMapAll[mk]['ALL__INACTIVE'] = (subMonthMapAll[mk]['ALL__INACTIVE'] || 0) + (isInactive ? 1 : 0);
    subMonthMapAll[mk]['ALL__TOTAL']    = (subMonthMapAll[mk]['ALL__TOTAL']    || 0) + 1;
  });
  // Keep ALL months for cumulative calculation but chart shows from go-live
  const subMonthlyAll = Object.values(subMonthMapAll).sort((a,b)=>a.month_key.localeCompare(b.month_key));
  // Pre-compute cumulative for ALL countries and PH before filtering for display
  const subMonthly = subMonthlyAll.filter(m => m.month_key >= GO_LIVE_MONTH);

  // ── Subscriber status analysis ──
  const subStats = { ACTIVE:{paid:0,unpaid:0,byCountry:{}}, VERIFY:{paid:0,unpaid:0}, SUSPENDED:{paid:0,unpaid:0} };
  subRows.forEach(r => {
    const st  = r.subscriberstatus || "Unknown";
    const paid = paying_ids.has(r.initiatedby);
    const cc   = r.subscribercountry || "Unknown";
    if (st === "ACTIVE") {
      if (paid) {
        subStats.ACTIVE.paid++;
        subStats.ACTIVE.byCountry[cc] = (subStats.ACTIVE.byCountry[cc]||0) + 1;
      } else subStats.ACTIVE.unpaid++;
    } else if (st === "VERIFY")    { paid ? subStats.VERIFY.paid++    : subStats.VERIFY.unpaid++; }
    else if (st === "SUSPENDED")   { paid ? subStats.SUSPENDED.paid++ : subStats.SUSPENDED.unpaid++; }
  });

  // Flag anomalies: VERIFY but paid
  const anomalies = subRows.filter(r => r.subscriberstatus==="VERIFY" && paying_ids.has(r.initiatedby))
    .map(r => ({ ...r, country: countryMap[r.initiatedby]||"Unknown" }));

  // ── Monthly aggregates ──
  const monthMap = {};
  success.forEach(r => {
    const k = r.month_key;
    if (!monthMap[k]) monthMap[k] = { month_key:k, month:r.month, total:0, renewals:0, new_subs:0, METROBANK:0, PINBASED:0, INAPP:0 };
    const m = monthMap[k], gw = (r.gwprovider||"").toUpperCase();
    m.total++;
    if (r.type==="Renewal") m.renewals++; else m.new_subs++;
    if (gw==="METROBANK") m.METROBANK++;
    if (gw==="PINBASED")  m.PINBASED++;
    if (gw==="INAPP")     m.INAPP++;
  });
  const monthly = Object.values(monthMap).sort((a,b)=>a.month_key.localeCompare(b.month_key));

  // ── Country summary ──
  const cMap = {};
  success.forEach(r => {
    const c = r.country;
    if (!cMap[c]) cMap[c] = { country:c, label:COUNTRY_NAMES[c]||c, total:0, renewals:0, new_subs:0 };
    cMap[c].total++;
    if (r.type==="Renewal") cMap[c].renewals++; else cMap[c].new_subs++;
  });
  const countryList = Object.values(cMap).sort((a,b)=>b.total-a.total);
  const countries   = ["ALL", ...countryList.map(c=>c.country)];

  const totals = monthly.reduce((acc,m) => ({
    total:acc.total+m.total, renewals:acc.renewals+m.renewals, new_subs:acc.new_subs+m.new_subs,
    METROBANK:acc.METROBANK+m.METROBANK, PINBASED:acc.PINBASED+m.PINBASED, INAPP:acc.INAPP+m.INAPP,
  }), {total:0,renewals:0,new_subs:0,METROBANK:0,PINBASED:0,INAPP:0});

  const uniqueCustomers = new Set(success.map(r=>r.initiatedby)).size;
  return { success, monthly, totals, countryList, countries, uniqueCustomers, dateFrom, dateTo, subStats, anomalies, subRows, subMonthly, subMonthlyAll, GO_LIVE_MONTH };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = n => (n||0).toLocaleString();
const pct     = (a,b) => b ? Math.round(a/b*100) : 0;
const fmtDate = d => d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
// Build a clean "Jul '25" label from a "2025-07" month_key — avoids toLocaleString locale issues
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtMonthKey = mk => { const [y,m] = mk.split("-"); return `${MONTH_ABBR[+m-1]} '${y.slice(2)}`; };

function StatCard({ label, value, sub, color, icon, onClick, active }) {
  return (
    <div onClick={onClick} style={{ background:"#fff", borderRadius:12, padding:"16px 18px",
      boxShadow:"0 1px 4px rgba(0,0,0,0.08)", borderTop:`4px solid ${color}`,
      cursor: onClick?"pointer":"default", outline: active?"2px solid "+color:"none" }}>
      <div style={{ fontSize:20 }}>{icon}</div>
      <div style={{ fontSize:26, fontWeight:800, color, marginTop:4 }}>{value}</div>
      <div style={{ fontSize:12, fontWeight:600, color:"#374151", marginTop:2 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:"#1e293b", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#f8fafc" }}>
      <div style={{ fontWeight:700, marginBottom:6, color:"#94a3b8" }}>{label}</div>
      {payload.map(p=>(
        <div key={p.name} style={{ display:"flex", justifyContent:"space-between", gap:12, marginBottom:2 }}>
          <span style={{ color:p.color }}>{p.name}</span><span style={{ fontWeight:700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{ background:bg, color, padding:"2px 10px", borderRadius:12, fontSize:11, fontWeight:700 }}>{children}</span>;
}

function SelFilter({ value, onChange, options, labelMap }) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12, color:"#374151" }}>
      {options.map(o=><option key={o} value={o}>{labelMap?.[o]||o}</option>)}
    </select>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [data,          setData]          = useState(null);
  const [payFileName,   setPayFileName]   = useState("");
  const [subFileName,   setSubFileName]   = useState("");
  const [subRows,       setSubRows]       = useState([]);
  const [payRows,       setPayRows]       = useState([]);
  const [tab,           setTab]           = useState("overview");
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [gwFilter,      setGwFilter]      = useState("ALL");
  const [moFilter,      setMoFilter]      = useState("ALL");
  const [typeFilter,    setTypeFilter]    = useState("ALL");
  const [statusFilter,  setStatusFilter]  = useState("ALL");
  const [dragging,      setDragging]      = useState(false);

  const rebuild = (pay, sub) => setData(processData(pay, sub));
  const loadPay = file => Papa.parse(file, { header:true, skipEmptyLines:true, complete:({data:rows})=>{ setPayRows(rows); setPayFileName(file.name); rebuild(rows, subRows); }});
  const loadSub = file => Papa.parse(file, { header:true, skipEmptyLines:true, complete:({data:rows})=>{ setSubRows(rows); setSubFileName(file.name); rebuild(payRows, rows); }});
  const onDrop  = useCallback(e=>{ e.preventDefault(); setDragging(false); const f=e.dataTransfer.files[0]; if(f) loadPay(f); },[subRows]);

  // Show upload screen if either file is missing
  const bothLoaded = payRows.length > 0 && subRows.length > 0 && data && data.success.length > 0;

  if (!bothLoaded) return (
    <div style={{ fontFamily:"'Inter',sans-serif", minHeight:"100vh", background:"#f1f5f9",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 }}>
      <div style={{ fontSize:52 }}>📊</div>
      <h2 style={{ margin:0, color:"#1e293b" }}>Renewal Dashboard</h2>
      <p style={{ color:"#64748b", margin:0, fontSize:14 }}>Upload <b>both</b> files to get started</p>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginTop:8 }}>
        {[
          { label:"💳 Payment Report CSV", load:loadPay, name:payFileName, done: payRows.length>0 },
          { label:"👥 Subscriber Report CSV", load:loadSub, name:subFileName, done: subRows.length>0 },
        ].map(f=>(
          <div key={f.label} style={{ background:"#fff", borderRadius:16, padding:"28px 32px", textAlign:"center",
            border:`2px dashed ${f.done?"#0e9f6e":"#cbd5e1"}`, minWidth:220,
            boxShadow: f.done?"0 0 0 2px #0e9f6e22":"none" }}>
            <div style={{ fontSize:36, marginBottom:8 }}>{f.done?"✅":"📂"}</div>
            <div style={{ fontSize:14, fontWeight:700, color:"#374151", marginBottom:6 }}>{f.label}</div>
            {f.name
              ? <div style={{ fontSize:12, color:"#0e9f6e", fontWeight:600, marginBottom:12 }}>✅ {f.name}</div>
              : <div style={{ fontSize:12, color:"#94a3b8", marginBottom:12 }}>Not uploaded yet</div>
            }
            <label style={{ background: f.done?"#0e9f6e":"#1a56db", color:"#fff", padding:"8px 18px",
              borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer" }}>
              {f.done ? "Re-upload" : "Choose File"}
              <input type="file" accept=".csv" style={{ display:"none" }} onChange={e=>{ if(e.target.files[0]) f.load(e.target.files[0]); }} />
            </label>
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8 }}>
        <div style={{ width:12, height:12, borderRadius:"50%", background: payRows.length>0?"#0e9f6e":"#e2e8f0" }} />
        <div style={{ fontSize:12, color: payRows.length>0?"#0e9f6e":"#94a3b8" }}>Payment file {payRows.length>0?"loaded ✓":"pending"}</div>
        <div style={{ width:40, height:2, background:"#e2e8f0" }} />
        <div style={{ width:12, height:12, borderRadius:"50%", background: subRows.length>0?"#0e9f6e":"#e2e8f0" }} />
        <div style={{ fontSize:12, color: subRows.length>0?"#0e9f6e":"#94a3b8" }}>Subscriber file {subRows.length>0?"loaded ✓":"pending"}</div>
        <div style={{ width:40, height:2, background:"#e2e8f0" }} />
        <div style={{ width:12, height:12, borderRadius:"50%", background: bothLoaded?"#0e9f6e":"#e2e8f0" }} />
        <div style={{ fontSize:12, color: bothLoaded?"#0e9f6e":"#94a3b8" }}>Dashboard ready</div>
      </div>

      <p style={{ fontSize:12, color:"#94a3b8", marginTop:4 }}>
        Dashboard will appear automatically once both files are uploaded
      </p>
    </div>
  );

  const { success, monthly, totals, countryList, countries, uniqueCustomers, dateFrom, dateTo, subStats, anomalies, subRows: sRows, subMonthly, subMonthlyAll, GO_LIVE_MONTH } = data;

  // ── Apply filters ──
  const filtered = success.filter(r => {
    if (countryFilter !== "ALL" && r.country !== countryFilter) return false;
    if (gwFilter      !== "ALL" && (r.gwprovider||"").toUpperCase() !== gwFilter) return false;
    if (moFilter      !== "ALL" && r.month_key !== moFilter) return false;
    if (typeFilter    !== "ALL" && r.type !== typeFilter) return false;
    // statusFilter only used in renewals tab table, not for main data
    return true;
  });

  // Filtered monthly
  const fmMap = {};
  filtered.forEach(r => {
    const k = r.month_key;
    if (!fmMap[k]) fmMap[k] = { month_key:k, month:r.month, total:0, renewals:0, new_subs:0, METROBANK:0, PINBASED:0, INAPP:0 };
    const m = fmMap[k], gw = (r.gwprovider||"").toUpperCase();
    m.total++; if (r.type==="Renewal") m.renewals++; else m.new_subs++;
    if (gw==="METROBANK") m.METROBANK++; if (gw==="PINBASED") m.PINBASED++; if (gw==="INAPP") m.INAPP++;
  });
  const fMonthly = Object.values(fmMap).sort((a,b)=>a.month_key.localeCompare(b.month_key));
  const fTotals  = fMonthly.reduce((acc,m)=>({ total:acc.total+m.total, renewals:acc.renewals+m.renewals, new_subs:acc.new_subs+m.new_subs }), {total:0,renewals:0,new_subs:0});
  const trend    = fMonthly.map(m=>({...m, month:fmtMonthKey(m.month_key)}));

  // Subscriber monthly data filtered by country AND status
  const filterCC = countryFilter === "ALL" ? "ALL" : countryFilter;

  // First calculate pre-launch cumulative (months before GO_LIVE_MONTH)
  let _preLaunch = 0;
  subMonthlyAll.filter(m => m.month_key < GO_LIVE_MONTH).forEach(m => {
    const active   = m[`${filterCC}__ACTIVE`]   || 0;
    const inactive = m[`${filterCC}__INACTIVE`] || 0;
    const total    = m[`${filterCC}__TOTAL`]    || 0;
    const count    = statusFilter === "ACTIVE"   ? active
                   : statusFilter === "INACTIVE" ? inactive
                   : total;
    _preLaunch += count;
  });

  // Then build filtered monthly starting from go-live, cumulative includes pre-launch
  const subMonthlyFiltered = subMonthly.map(m => {
    const active   = m[`${filterCC}__ACTIVE`]   || 0;
    const inactive = m[`${filterCC}__INACTIVE`] || 0;
    const total    = m[`${filterCC}__TOTAL`]    || 0;
    const count    = statusFilter === "ACTIVE"   ? active
                   : statusFilter === "INACTIVE" ? inactive
                   : total;
    return { ...m, month: fmtMonthKey(m.month_key), new_subscribers: count, active, inactive, total };
  });
  // Cumulative includes pre-launch baseline
  let _cum = _preLaunch;
  subMonthlyFiltered.forEach(m => { _cum += m.new_subscribers; m.total_active = _cum; });

  // Region monthly (renewals only)
  const rgMap = {};
  success.filter(r => r.type==="Renewal" && (countryFilter==="ALL"||r.country===countryFilter)).forEach(r => {
    if (!rgMap[r.month_key]) rgMap[r.month_key] = { month_key:r.month_key, month:r.month };
    rgMap[r.month_key][r.country] = (rgMap[r.month_key][r.country]||0)+1;
  });
  const regionTrend = Object.values(rgMap).sort((a,b)=>a.month_key.localeCompare(b.month_key)).map(m=>({...m,month:fmtMonthKey(m.month_key)}));
  const topCountries = countryList.slice(0,8);

  const countryLabelMap = { ALL:"All Countries", ...Object.fromEntries(countries.filter(c=>c!=="ALL").map(c=>[c,COUNTRY_NAMES[c]||c])) };
  const tabs = ["overview","analytics","renewals","region","subscribers","gateway"];

  // Subscriber status analysis for region
  const regionSubStats = {};
  sRows.forEach(r => {
    const cc = r.subscribercountry || "Unknown";
    const st = r.subscriberstatus || "Unknown";
    const paid = success.some(p => p.initiatedby === r.initiatedby);
    if (!regionSubStats[cc]) regionSubStats[cc] = { country:cc, ACTIVE_paid:0, ACTIVE_unpaid:0, VERIFY:0, SUSPENDED:0 };
    if (st==="ACTIVE") { paid ? regionSubStats[cc].ACTIVE_paid++ : regionSubStats[cc].ACTIVE_unpaid++; }
    else if (st==="VERIFY") regionSubStats[cc].VERIFY++;
    else if (st==="SUSPENDED") regionSubStats[cc].SUSPENDED++;
  });
  const regionSubList = Object.values(regionSubStats).sort((a,b)=>(b.ACTIVE_paid+b.ACTIVE_unpaid)-(a.ACTIVE_paid+a.ACTIVE_unpaid));

  return (
    <div style={{ fontFamily:"'Inter',sans-serif", background:"#f1f5f9", minHeight:"100vh", color:"#1e293b" }}>

      {/* HEADER */}
      <div style={{ background:"#1e293b", padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:800, color:"#f8fafc" }}>💳 Renewal Dashboard</h1>
          <p style={{ margin:"3px 0 0", fontSize:11, color:"#94a3b8" }}>
            {payFileName} + {subFileName} · {fmtDate(dateFrom)} → {fmtDate(dateTo)} · SUCCESS only
          </p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[{label:"💳 Payment CSV",load:loadPay,color:"#3b82f6"},{label:"👥 Subscriber CSV",load:loadSub,color:"#0e9f6e"}].map(f=>(
            <label key={f.label} style={{ background:f.color, color:"#fff", padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer" }}>
              {f.label}<input type="file" accept=".csv" style={{ display:"none" }} onChange={e=>{ if(e.target.files[0]) f.load(e.target.files[0]); }} />
            </label>
          ))}
        </div>
      </div>

      {/* INFO BANNER */}
      <div style={{ background:"#0f172a", padding:"8px 24px", display:"flex", gap:24, fontSize:12, color:"#94a3b8", flexWrap:"wrap" }}>
        <span>📅 <b style={{color:"#f8fafc"}}>{fmtDate(dateFrom)}</b> → <b style={{color:"#f8fafc"}}>{fmtDate(dateTo)}</b></span>
        <span>👥 <b style={{color:"#f8fafc"}}>{fmt(uniqueCustomers)}</b> paying customers</span>
        <span>✅ <b style={{color:"#0e9f6e"}}>{fmt(subStats.ACTIVE.paid)}</b> Active + Paid</span>
        <span>⚠️ <b style={{color:"#e3a008"}}>{fmt(subStats.ACTIVE.unpaid)}</b> Active + Never Paid</span>
        <span>🔴 <b style={{color:"#e02424"}}>{fmt(subStats.VERIFY.paid)}</b> VERIFY but Paid (anomaly)</span>
      </div>

      {/* GLOBAL FILTERS */}
      <div style={{ background:"#fff", padding:"10px 24px", display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", borderBottom:"1px solid #e2e8f0" }}>
        <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>🔍 Filter:</span>
        <SelFilter value={countryFilter} onChange={setCountryFilter} options={countries} labelMap={countryLabelMap} />
        <SelFilter value={statusFilter} onChange={setStatusFilter}
          options={["ALL","ACTIVE","INACTIVE"]}
          labelMap={{ ALL:"All Statuses", ACTIVE:"Active Only", INACTIVE:"Inactive Only" }} />
        {/* Status filter only shown in Renewals tab */}
        <SelFilter value={gwFilter} onChange={setGwFilter} options={["ALL","METROBANK","PINBASED","INAPP"]} labelMap={{ ALL:"All Gateways", METROBANK:"Metrobank", PINBASED:"PIN-Based", INAPP:"In-App" }} />
        <SelFilter value={moFilter} onChange={setMoFilter} options={["ALL",...monthly.map(m=>m.month_key)]} labelMap={{ ALL:"All Months", ...Object.fromEntries(monthly.map(m=>[m.month_key,m.month])) }} />
        <SelFilter value={typeFilter} onChange={setTypeFilter} options={["ALL","Renewal","New"]} labelMap={{ ALL:"All Types" }} />
        {(countryFilter!=="ALL"||gwFilter!=="ALL"||moFilter!=="ALL"||typeFilter!=="ALL") && (
          <button onClick={()=>{setCountryFilter("ALL");setGwFilter("ALL");setMoFilter("ALL");setTypeFilter("ALL");setStatusFilter("ALL");}}
            style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #e02424", background:"#fff", color:"#e02424", fontSize:12, fontWeight:700, cursor:"pointer" }}>✕ Clear</button>
        )}
        <span style={{ marginLeft:"auto", fontSize:12, color:"#94a3b8" }}>{fmt(filtered.length)} transactions</span>
      </div>

      {/* TABS */}
      <div style={{ display:"flex", gap:2, padding:"12px 24px 0", background:"#fff", borderBottom:"1px solid #e2e8f0" }}>
        {tabs.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:"8px 20px", border:"none", cursor:"pointer", fontSize:13, fontWeight:700, textTransform:"capitalize",
            background:"transparent", color:tab===t?"#1a56db":"#64748b",
            borderBottom:tab===t?"2px solid #1a56db":"2px solid transparent",
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding:"24px" }}>

        {/* ══ OVERVIEW ══ */}
        {tab==="overview" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:14, marginBottom:22 }}>
              <StatCard label="Total Transactions" value={fmt(fTotals.total)} color="#1a56db" icon="📊" />
              <StatCard label="Renewals" value={fmt(fTotals.renewals)} sub={`${pct(fTotals.renewals,fTotals.total)}% of total`} color="#7c3aed" icon="🔄" />
              <StatCard label="New Subscriptions" value={fmt(fTotals.new_subs)} sub={`${pct(fTotals.new_subs,fTotals.total)}% of total`} color="#0891b2" icon="✨" />
              <StatCard label="Active + Paid" value={fmt(subStats.ACTIVE.paid)} color="#0e9f6e" icon="✅" />
              <StatCard label="Active + Never Paid" value={fmt(subStats.ACTIVE.unpaid)} color="#e3a008" icon="⚠️" />
            </div>

            <div style={{ background:"#fff", borderRadius:12, padding:20, marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Monthly — Renewal vs New Subscription</h3>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize:11 }} />
                  <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
                  <Tooltip content={<Tip />} />
                  <Legend wrapperStyle={{ fontSize:12 }} />
                  <Bar dataKey="new_subs" name="New Subs" stackId="a" fill="#0891b2" />
                  <Bar dataKey="renewals" name="Renewals" stackId="a" fill="#7c3aed" radius={[4,4,0,0]} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#f97316" strokeWidth={2} dot={{ r:3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 14px", fontSize:14, fontWeight:700 }}>Monthly Summary</h3>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#f8fafc" }}>
                      {["Month","Total","New","Renewals","Renewal %","Metrobank","PIN-Based","In-App"].map(h=>(
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontWeight:700, color:"#374151", fontSize:12, borderBottom:"2px solid #e2e8f0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fMonthly.map((m,i)=>(
                      <tr key={m.month_key} style={{ background:i%2===0?"#fff":"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                        <td style={{ padding:"9px 12px", fontWeight:700 }}>{m.month}</td>
                        <td style={{ padding:"9px 12px" }}>{m.total}</td>
                        <td style={{ padding:"9px 12px" }}><Badge color="#0369a1" bg="#e0f2fe">{m.new_subs}</Badge></td>
                        <td style={{ padding:"9px 12px" }}><Badge color="#6d28d9" bg="#ede9fe">{m.renewals}</Badge></td>
                        <td style={{ padding:"9px 12px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ background:"#e2e8f0", borderRadius:4, height:7, width:60, overflow:"hidden" }}>
                              <div style={{ background:"#7c3aed", height:"100%", width:`${pct(m.renewals,m.total)}%` }} />
                            </div>
                            <span style={{ fontSize:11, fontWeight:700, color:"#7c3aed" }}>{pct(m.renewals,m.total)}%</span>
                          </div>
                        </td>
                        <td style={{ padding:"9px 12px", color:GW_COLORS.METROBANK, fontWeight:600 }}>{m.METROBANK}</td>
                        <td style={{ padding:"9px 12px", color:GW_COLORS.PINBASED,  fontWeight:600 }}>{m.PINBASED}</td>
                        <td style={{ padding:"9px 12px", color:GW_COLORS.INAPP,     fontWeight:600 }}>{m.INAPP}</td>
                      </tr>
                    ))}
                    <tr style={{ background:"#1e293b", color:"#f8fafc", fontWeight:800 }}>
                      <td style={{ padding:"9px 12px" }}>TOTAL</td>
                      <td style={{ padding:"9px 12px" }}>{fTotals.total}</td>
                      <td style={{ padding:"9px 12px" }}>{fTotals.new_subs}</td>
                      <td style={{ padding:"9px 12px" }}>{fTotals.renewals}</td>
                      <td style={{ padding:"9px 12px" }}>{pct(fTotals.renewals,fTotals.total)}%</td>
                      <td style={{ padding:"9px 12px", color:"#93c5fd" }}>{filtered.filter(r=>r.gwprovider==="METROBANK").length}</td>
                      <td style={{ padding:"9px 12px", color:"#fcd34d" }}>{filtered.filter(r=>r.gwprovider==="PINBASED").length}</td>
                      <td style={{ padding:"9px 12px", color:"#6ee7b7" }}>{filtered.filter(r=>r.gwprovider==="INAPP").length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ RENEWALS ══ */}
        {tab==="renewals" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:14, marginBottom:22 }}>
              <StatCard label="Total Renewals" value={fmt(filtered.filter(r=>r.type==="Renewal"&&(statusFilter==="ALL"||r.sub_status===statusFilter)).length)} color="#7c3aed" icon="🔄" />
              <StatCard label="via Metrobank" value={fmt(filtered.filter(r=>r.type==="Renewal"&&r.gwprovider==="METROBANK"&&(statusFilter==="ALL"||r.sub_status===statusFilter)).length)} color={GW_COLORS.METROBANK} icon="🏦" />
              <StatCard label="via PIN-Based" value={fmt(filtered.filter(r=>r.type==="Renewal"&&r.gwprovider==="PINBASED"&&(statusFilter==="ALL"||r.sub_status===statusFilter)).length)} color={GW_COLORS.PINBASED} icon="🔢" />
              <StatCard label="via In-App" value={fmt(filtered.filter(r=>r.type==="Renewal"&&r.gwprovider==="INAPP"&&(statusFilter==="ALL"||r.sub_status===statusFilter)).length)} color={GW_COLORS.INAPP} icon="📱" />
            </div>
            <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
                <h3 style={{ margin:0, fontSize:14, fontWeight:700, flex:1 }}>Renewal Transactions</h3>
                <span style={{ fontSize:12, color:"#64748b" }}>Filter by status:</span>
                <SelFilter value={statusFilter} onChange={setStatusFilter} options={["ALL","ACTIVE","VERIFY","SUSPENDED"]} labelMap={{ ALL:"All Statuses" }} />
              </div>
              <div style={{ overflowX:"auto", maxHeight:520, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead style={{ position:"sticky", top:0 }}>
                    <tr style={{ background:"#1e293b", color:"#f8fafc" }}>
                      {["Payment ID","Customer","Country","Status","Gateway","Amount","Month","Date"].map(h=>(
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.filter(r=>r.type==="Renewal" && (statusFilter==="ALL" || r.sub_status===statusFilter)).map((r,i)=>(
                      <tr key={i} style={{ background:i%2===0?"#fff":"#f8fafc", borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"7px 12px", color:"#64748b" }}>{r.paymentid}</td>
                        <td style={{ padding:"7px 12px" }}>
                          <div style={{ fontWeight:600 }}>{r.sub_name||r.initiatedby}</div>
                          {r.sub_name && <div style={{ fontSize:10, color:"#94a3b8" }}>{r.initiatedby}</div>}
                        </td>
                        <td style={{ padding:"7px 12px", whiteSpace:"nowrap" }}>{COUNTRY_NAMES[r.country]||r.country}</td>
                        <td style={{ padding:"7px 12px" }}>
                          <Badge color={STATUS_COLORS[r.sub_status]||"#64748b"} bg={(STATUS_COLORS[r.sub_status]||"#64748b")+"22"}>{r.sub_status}</Badge>
                        </td>
                        <td style={{ padding:"7px 12px" }}>
                          <Badge color={GW_COLORS[(r.gwprovider||"").toUpperCase()]} bg={GW_COLORS[(r.gwprovider||"").toUpperCase()]+"22"}>
                            {GW_LABELS[(r.gwprovider||"").toUpperCase()]||r.gwprovider}
                          </Badge>
                        </td>
                        <td style={{ padding:"7px 12px", fontWeight:700 }}>₱{Number(r.amount||0).toLocaleString()}</td>
                        <td style={{ padding:"7px 12px", color:"#64748b" }}>{r.month}</td>
                        <td style={{ padding:"7px 12px", color:"#64748b", whiteSpace:"nowrap" }}>{r._date.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"})}</td>
                      </tr>
                    ))}
                    {filtered.filter(r=>r.type==="Renewal").length===0 && (
                      <tr><td colSpan={8} style={{ textAlign:"center", padding:32, color:"#94a3b8" }}>No renewal records match the filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ REGION ══ */}
        {tab==="region" && (
          <div>
            {/* Country subscriber status table */}
            <div style={{ background:"#fff", borderRadius:12, padding:20, marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 6px", fontSize:14, fontWeight:700 }}>Subscriber Status by Country</h3>
              <p style={{ margin:"0 0 14px", fontSize:12, color:"#64748b" }}>Active Paid = completed registration + made at least 1 payment · Active Unpaid = registered but never paid</p>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#1e293b", color:"#f8fafc" }}>
                      {["Country","✅ Active + Paid","⚠️ Active + Never Paid","🔍 VERIFY","🚫 Suspended","Total"].map(h=>(
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {regionSubList.filter(r=>(countryFilter==="ALL"||r.country===countryFilter)).map((r,i)=>{
                      const total = r.ACTIVE_paid + r.ACTIVE_unpaid + r.VERIFY + r.SUSPENDED;
                      return (
                        <tr key={r.country} style={{ background:i%2===0?"#fff":"#f8fafc", borderBottom:"1px solid #e2e8f0",
                          cursor:"pointer", outline: countryFilter===r.country?"2px solid #1a56db":"none" }}
                          onClick={()=>setCountryFilter(r.country===countryFilter?"ALL":r.country)}>
                          <td style={{ padding:"9px 12px", fontWeight:700 }}>{COUNTRY_NAMES[r.country]||r.country}</td>
                          <td style={{ padding:"9px 12px" }}><Badge color="#065f46" bg="#d1fae5">{r.ACTIVE_paid}</Badge></td>
                          <td style={{ padding:"9px 12px" }}><Badge color="#92400e" bg="#fef3c7">{r.ACTIVE_unpaid}</Badge></td>
                          <td style={{ padding:"9px 12px", color: r.VERIFY>0?"#e3a008":"#94a3b8", fontWeight:r.VERIFY>0?700:400 }}>{r.VERIFY||"—"}</td>
                          <td style={{ padding:"9px 12px", color: r.SUSPENDED>0?"#e02424":"#94a3b8", fontWeight:r.SUSPENDED>0?700:400 }}>{r.SUSPENDED||"—"}</td>
                          <td style={{ padding:"9px 12px", fontWeight:700 }}>{total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Renewals by country chart */}
            <div style={{ background:"#fff", borderRadius:12, padding:20, marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Renewals by Country — Monthly</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={regionTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize:10 }} />
                  <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
                  <Tooltip content={<Tip />} />
                  <Legend wrapperStyle={{ fontSize:11 }} />
                  {topCountries.map((c,i)=>(
                    <Bar key={c.country} dataKey={c.country} name={COUNTRY_NAMES[c.country]||c.country}
                      stackId="r" fill={COUNTRY_COLORS[i%COUNTRY_COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Anomalies */}
            {anomalies.length > 0 && (
              <div style={{ background:"#fffbeb", borderRadius:12, padding:20, border:"1px solid #fcd34d", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 10px", fontSize:14, fontWeight:700, color:"#92400e" }}>⚠️ Anomaly — VERIFY Status but Payment Found ({anomalies.length})</h3>
                <p style={{ margin:"0 0 14px", fontSize:12, color:"#92400e" }}>These customers completed payment but their account is still in VERIFY status. May need manual review.</p>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#fef3c7" }}>
                      {["Customer ID","Name","Country","Status"].map(h=>(
                        <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:"#92400e" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {anomalies.map((r,i)=>(
                      <tr key={i} style={{ borderBottom:"1px solid #fcd34d" }}>
                        <td style={{ padding:"7px 12px", fontFamily:"monospace", fontSize:11 }}>{r.initiatedby}</td>
                        <td style={{ padding:"7px 12px", fontWeight:600 }}>{r.subscribername}</td>
                        <td style={{ padding:"7px 12px" }}>{COUNTRY_NAMES[r.country]||r.country}</td>
                        <td style={{ padding:"7px 12px" }}><Badge color="#92400e" bg="#fef3c7">{r.subscriberstatus}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══ SUBSCRIBERS ══ */}
        {tab==="subscribers" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:14, marginBottom:22 }}>
              <StatCard label="Total Subscribers" value={fmt(sRows.length)} color="#1a56db" icon="👥" />
              <StatCard label="Active + Paid" value={fmt(subStats.ACTIVE.paid)} sub="completed reg + payment" color="#0e9f6e" icon="✅" />
              <StatCard label="Active + Never Paid" value={fmt(subStats.ACTIVE.unpaid)} sub="registered only" color="#e3a008" icon="⚠️" />
              <StatCard label="VERIFY" value={fmt(subStats.VERIFY.paid + subStats.VERIFY.unpaid)} sub={`${subStats.VERIFY.paid} paid anomaly`} color="#f97316" icon="🔍" />
              <StatCard label="Suspended" value={fmt(subStats.SUSPENDED.paid + subStats.SUSPENDED.unpaid)} color="#e02424" icon="🚫" />
            </div>

            {/* Total Active Subscribers trend */}
            <div style={{ background:"#fff", borderRadius:12, padding:20, marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 4px", fontSize:14, fontWeight:700 }}>📈 Total Active Subscribers — Monthly Trend</h3>
              <p style={{ margin:"0 0 14px", fontSize:11, color:"#64748b" }}>Cumulative active subscribers from go-live (Jul 2025) · filtered by region & status above</p>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={subMonthlyFiltered} margin={{ top:28, right:20, left:0, bottom:5 }}>
                  <defs>
                    <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1a56db" stopOpacity={0.5}/>
                      <stop offset="100%" stopColor="#1a56db" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false}/>
                  <XAxis dataKey="month" tick={{ fontSize:11 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip formatter={v=>[v,"Total Active"]}/>
                  <Area type="linear" dataKey="total_active" name="Total Active Subscribers"
                    stroke="#1a56db" strokeWidth={2.5} fill="url(#subGrad)"
                    dot={{ fill:"#1a56db", r:4, stroke:"#fff", strokeWidth:2 }}>
                    <LabelList dataKey="total_active" position="top" style={{ fontSize:10, fontWeight:700, fill:"#1a56db" }}/>
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* New Subscribers per month */}
            <div style={{ background:"#fff", borderRadius:12, padding:20, marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 4px", fontSize:14, fontWeight:700 }}>✨ New Subscribers per Month</h3>
              <p style={{ margin:"0 0 14px", fontSize:11, color:"#64748b" }}>New registrations each month · filtered by region & status above</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={subMonthlyFiltered}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize:10 }} />
                  <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
                  <Tooltip content={<Tip />} />
                  <Bar dataKey="new_subscribers" name="New Subscribers" fill="#0e9f6e" radius={[4,4,0,0]}>
                    <LabelList dataKey="new_subscribers" position="top" style={{ fontSize:10, fontWeight:700, fill:"#065f46" }}/>
                    {subMonthlyFiltered.map((m,i)=>(
                      <Cell key={i} fill={m.new_subscribers > 200 ? "#0e9f6e" : m.new_subscribers > 100 ? "#0891b2" : "#7c3aed"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Subscriber status pie */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18, marginBottom:18 }}>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Active Subscriber Breakdown</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={[
                      { name:"Active + Paid", value:subStats.ACTIVE.paid },
                      { name:"Active + Never Paid", value:subStats.ACTIVE.unpaid },
                      { name:"VERIFY", value:subStats.VERIFY.paid+subStats.VERIFY.unpaid },
                      { name:"Suspended", value:subStats.SUSPENDED.paid+subStats.SUSPENDED.unpaid },
                    ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                      label={({name,percent})=>`${(percent*100).toFixed(0)}%`}>
                      {["#0e9f6e","#e3a008","#f97316","#e02424"].map((c,i)=><Cell key={i} fill={c} />)}
                    </Pie>
                    <Tooltip /><Legend wrapperStyle={{ fontSize:11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Active Paid by Country</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={Object.entries(subStats.ACTIVE.byCountry).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([c,v])=>({ country:COUNTRY_NAMES[c]||c, count:v }))} layout="vertical" barSize={14}>
                    <XAxis type="number" tick={{ fontSize:11 }} allowDecimals={false} />
                    <YAxis dataKey="country" type="category" tick={{ fontSize:10 }} width={110} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="count" name="Customers" fill="#0e9f6e" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ══ ANALYTICS ══ */}
        {tab==="analytics" && (() => {
          const filterCC = countryFilter === "ALL" ? "ALL" : countryFilter;

          // Pre-launch baseline
          let _preLaunch = 0;
          subMonthlyAll.filter(m => m.month_key < GO_LIVE_MONTH).forEach(m => {
            const a=m[`${filterCC}__ACTIVE`]||0, i=m[`${filterCC}__INACTIVE`]||0, t=m[`${filterCC}__TOTAL`]||0;
            _preLaunch += statusFilter==="ACTIVE"?a:statusFilter==="INACTIVE"?i:t;
          });

          // Subscriber trend from go-live
          const subTrend = subMonthly.map(m => {
            const active   = m[`${filterCC}__ACTIVE`]   || 0;
            const inactive = m[`${filterCC}__INACTIVE`] || 0;
            const total    = m[`${filterCC}__TOTAL`]    || 0;
            const count    = statusFilter==="ACTIVE"?active:statusFilter==="INACTIVE"?inactive:total;
            return { month_key:m.month_key, month:fmtMonthKey(m.month_key), new_subscribers:count };
          });
          let _cum = _preLaunch;
          subTrend.forEach(m => { _cum += m.new_subscribers; m.total_active = _cum; });

          // Transaction trend from go-live only (start Jul 2025)
          const txnTrend = trend.filter(m => m.month_key >= GO_LIVE_MONTH);

          // Renewal trend by gateway per month
          const renewalByGW = {};
          success.filter(r => r.type==="Renewal" && r.month_key >= GO_LIVE_MONTH).forEach(r => {
            const k = r.month_key;
            const mo = fmtMonthKey(k);
            const gw = (r.gwprovider||"").toUpperCase();
            if (!renewalByGW[k]) renewalByGW[k] = { month_key:k, month:mo, METROBANK:0, PINBASED:0, INAPP:0, total:0 };
            if (gw==="METROBANK") renewalByGW[k].METROBANK++;
            if (gw==="PINBASED")  renewalByGW[k].PINBASED++;
            if (gw==="INAPP")     renewalByGW[k].INAPP++;
            renewalByGW[k].total++;
          });
          const renewalTrend = Object.values(renewalByGW).sort((a,b)=>a.month_key.localeCompare(b.month_key));

          // ── Shared styles ──
          const BLUE       = "#1a3a8f";
          const BLUE_LIGHT = "#7b9fd4";
          const BLUE_FILL  = "rgba(123,159,212,0.45)";

          // PDF-style diamond dot
          const DiamondDot = ({ cx, cy, fill, value }) => {
            if (!cx||!cy||!value) return null;
            const s=6;
            return <polygon points={`${cx},${cy-s} ${cx+s},${cy} ${cx},${cy+s} ${cx-s},${cy}`} fill={fill||BLUE} stroke="#fff" strokeWidth={1.5}/>;
          };

          // Value label above point
          const PtLabel = ({ x, y, value, fill }) => {
            if (value===undefined||value===null||value===0) return null;
            return <text x={x} y={y-10} textAnchor="middle" fontSize={10} fontWeight="700" fill={fill||BLUE}>{value}</text>;
          };

          // PDF-style data table (blue header, alternating rows)
          const PDFTable = ({ headers, rows, rowColors }) => (
            <div style={{ overflowX:"auto", marginTop:16 }}>
              <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%", border:"1px solid #b8cce4" }}>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri}>
                      <td style={{ padding:"7px 14px", fontWeight:700, background:"#2e75b6", color:"#fff",
                        whiteSpace:"nowrap", border:"1px solid #b8cce4", minWidth:200, fontSize:11 }}>
                        {headers[ri]}
                      </td>
                      {row.map((val, ci) => (
                        <td key={ci} style={{
                          padding:"7px 10px", textAlign:"center",
                          background: ri%2===0 ? "#dce6f1" : "#fff",
                          border:"1px solid #b8cce4",
                          color: rowColors?.[ri]||"#1e293b",
                          fontWeight:600, whiteSpace:"nowrap", fontSize:11
                        }}>{val ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );

          // Chart card wrapper
          const Card = ({ title, subtitle, children, headers, rows, rowColors }) => (
            <div style={{ background:"#fff", borderRadius:12, padding:24, marginBottom:20, boxShadow:"0 1px 6px rgba(0,0,0,0.08)" }}>
              <h3 style={{ margin:"0 0 0", fontSize:15, fontWeight:700, color:"#1e293b", textAlign:"center" }}>{title}</h3>
              {subtitle && <p style={{ margin:"4px 0 16px", fontSize:11, color:"#64748b", textAlign:"center" }}>{subtitle}</p>}
              {children}
              <PDFTable headers={headers} rows={rows} rowColors={rowColors} />
            </div>
          );

          const subLabel    = statusFilter==="ACTIVE"?"Active Subscribers":statusFilter==="INACTIVE"?"Inactive Subscribers":"Subscribers";
          const regionLabel = countryFilter==="ALL"?"All Regions":(COUNTRY_NAMES[countryFilter]||countryFilter);

          return (
            <div>

              {/* ══ Chart 1: Total Active Subscribers vs Month ══ */}
              <Card
                title="Active Subscribers vs Month"
                subtitle={`${regionLabel} · ${subLabel}`}
                headers={[`Total ${subLabel} (${regionLabel})`, "Month"]}
                rows={[ subTrend.map(m=>m.total_active), subTrend.map(m=>m.month) ]}
                rowColors={[BLUE, "#374151"]}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={subTrend} margin={{ top:28, right:20, left:0, bottom:5 }}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BLUE_LIGHT} stopOpacity={0.7}/>
                        <stop offset="100%" stopColor={BLUE_LIGHT} stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" vertical={false}/>
                    <XAxis dataKey="month" tick={{ fontSize:11, fill:"#374151" }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
                    <Tooltip formatter={v=>[v, subLabel]}/>
                    <Area type="linear" dataKey="total_active" name={subLabel}
                      stroke={BLUE} strokeWidth={2.5} fill="url(#g1)"
                      dot={<DiamondDot fill={BLUE}/>} activeDot={{r:6,fill:BLUE}}>
                      <LabelList dataKey="total_active" content={p=><PtLabel {...p} fill={BLUE}/>}/>
                    </Area>
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* ══ Chart 2: New Subscribers per Month ══ */}
              <Card
                title="New Subscribers vs Month"
                subtitle={`${regionLabel} · New ${subLabel} per month`}
                headers={[`New ${subLabel}`, "Month"]}
                rows={[ subTrend.map(m=>m.new_subscribers), subTrend.map(m=>m.month) ]}
                rowColors={[BLUE, "#374151"]}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={subTrend} margin={{ top:28, right:20, left:0, bottom:5 }}>
                    <defs>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BLUE_LIGHT} stopOpacity={0.7}/>
                        <stop offset="100%" stopColor={BLUE_LIGHT} stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" vertical={false}/>
                    <XAxis dataKey="month" tick={{ fontSize:11, fill:"#374151" }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
                    <Tooltip formatter={v=>[v, `New ${subLabel}`]}/>
                    <Area type="linear" dataKey="new_subscribers" name={`New ${subLabel}`}
                      stroke={BLUE} strokeWidth={2.5} fill="url(#g2)"
                      dot={<DiamondDot fill={BLUE}/>} activeDot={{r:6,fill:BLUE}}>
                      <LabelList dataKey="new_subscribers" content={p=><PtLabel {...p} fill={BLUE}/>}/>
                    </Area>
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* ══ Chart 3: Transaction Count — Metrobank, PIN-Based & In-App ══ */}
              <Card
                title="Transaction Count"
                subtitle="TRANSACTION — METRO-BANK, PIN-BASED & IN-APP"
                headers={["Month","Metrobank","Pin Based","In App"]}
                rows={[
                  txnTrend.map(m=>m.month),
                  txnTrend.map(m=>m.METROBANK||0),
                  txnTrend.map(m=>m.PINBASED||0),
                  txnTrend.map(m=>m.INAPP||0),
                ]}
                rowColors={["#374151", GW_COLORS.METROBANK, GW_COLORS.PINBASED, GW_COLORS.INAPP]}
              >
                <div style={{ display:"flex", gap:20, justifyContent:"center", marginBottom:10 }}>
                  {[["Metrobank",GW_COLORS.METROBANK],["PIN-Based",GW_COLORS.PINBASED],["In-App",GW_COLORS.INAPP]].map(([n,c])=>(
                    <span key={n} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, fontWeight:500 }}>
                      <span style={{ width:14, height:14, borderRadius:2, background:c, display:"inline-block" }}/>{n}
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={txnTrend} margin={{ top:28, right:20, left:0, bottom:5 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false}/>
                    <XAxis dataKey="month" tick={{ fontSize:11, fill:"#374151" }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
                    <Tooltip/>
                    <Bar dataKey="METROBANK" name="Metrobank" stackId="g" fill={GW_COLORS.METROBANK}>
                      <LabelList dataKey="METROBANK" position="inside" style={{ fontSize:9, fill:"#fff", fontWeight:700 }}/>
                    </Bar>
                    <Bar dataKey="PINBASED" name="PIN-Based" stackId="g" fill={GW_COLORS.PINBASED}>
                      <LabelList dataKey="PINBASED" position="inside" style={{ fontSize:9, fill:"#fff", fontWeight:700 }}/>
                    </Bar>
                    <Bar dataKey="INAPP" name="In-App" stackId="g" fill={GW_COLORS.INAPP} radius={[4,4,0,0]}>
                      <LabelList dataKey="INAPP" position="inside" style={{ fontSize:9, fill:"#fff", fontWeight:700 }}/>
                    </Bar>
                    <Line type="linear" dataKey="total" name="Total" stroke="#f97316" strokeWidth={2.5}
                      dot={<DiamondDot fill="#f97316"/>}>
                      <LabelList dataKey="total" content={p=><PtLabel {...p} fill="#f97316"/>}/>
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              {/* ══ Chart 4: Transaction Renewal Per Month ══ */}
              <Card
                title="Transaction Renewal Per Month"
                subtitle="Customers who purchased again the subscriptions — Metro-Bank, Pin Based and In App"
                headers={["Month","Metrobank","Pin Based","In - App"]}
                rows={[
                  renewalTrend.map(m=>m.month),
                  renewalTrend.map(m=>m.METROBANK||0),
                  renewalTrend.map(m=>m.PINBASED||0),
                  renewalTrend.map(m=>m.INAPP||0),
                ]}
                rowColors={["#374151", GW_COLORS.METROBANK, GW_COLORS.PINBASED, GW_COLORS.INAPP]}
              >
                <div style={{ display:"flex", gap:20, justifyContent:"center", marginBottom:10 }}>
                  {[["Metrobank",GW_COLORS.METROBANK],["PIN-Based",GW_COLORS.PINBASED],["In-App",GW_COLORS.INAPP]].map(([n,c])=>(
                    <span key={n} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, fontWeight:500 }}>
                      <span style={{ width:14, height:14, borderRadius:2, background:c, display:"inline-block" }}/>{n}
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={renewalTrend} margin={{ top:28, right:20, left:0, bottom:5 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false}/>
                    <XAxis dataKey="month" tick={{ fontSize:11, fill:"#374151" }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
                    <Tooltip/>
                    <Bar dataKey="METROBANK" name="Metrobank" stackId="r" fill={GW_COLORS.METROBANK}>
                      <LabelList dataKey="METROBANK" position="inside" style={{ fontSize:9, fill:"#fff", fontWeight:700 }}/>
                    </Bar>
                    <Bar dataKey="PINBASED" name="PIN-Based" stackId="r" fill={GW_COLORS.PINBASED}>
                      <LabelList dataKey="PINBASED" position="inside" style={{ fontSize:9, fill:"#fff", fontWeight:700 }}/>
                    </Bar>
                    <Bar dataKey="INAPP" name="In-App" stackId="r" fill={GW_COLORS.INAPP} radius={[4,4,0,0]}>
                      <LabelList dataKey="INAPP" position="inside" style={{ fontSize:9, fill:"#fff", fontWeight:700 }}/>
                    </Bar>
                    <Line type="linear" dataKey="total" name="Total" stroke="#f97316" strokeWidth={2.5}
                      dot={<DiamondDot fill="#f97316"/>}>
                      <LabelList dataKey="total" content={p=><PtLabel {...p} fill="#f97316"/>}/>
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

            </div>
          );
        })()}

        {/* ══ GATEWAY ══ */}
        {tab==="gateway" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:22 }}>
              {["METROBANK","PINBASED","INAPP"].map(gw=>(
                <StatCard key={gw} label={GW_LABELS[gw]}
                  value={fmt(filtered.filter(r=>(r.gwprovider||"").toUpperCase()===gw).length)}
                  sub={`${pct(filtered.filter(r=>(r.gwprovider||"").toUpperCase()===gw).length,fTotals.total)}% of total`}
                  color={GW_COLORS[gw]} icon={gw==="METROBANK"?"🏦":gw==="PINBASED"?"🔢":"📱"} />
              ))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Gateway Share</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={["METROBANK","PINBASED","INAPP"].map(gw=>({ name:GW_LABELS[gw], value:filtered.filter(r=>(r.gwprovider||"").toUpperCase()===gw).length }))}
                      dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                      label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>
                      {["METROBANK","PINBASED","INAPP"].map(gw=><Cell key={gw} fill={GW_COLORS[gw]} />)}
                    </Pie><Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Gateway by Month</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={trend} barSize={12}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize:10 }} />
                    <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
                    <Tooltip content={<Tip />} /><Legend wrapperStyle={{ fontSize:12 }} />
                    <Bar dataKey="METROBANK" name="Metrobank" stackId="g" fill={GW_COLORS.METROBANK} />
                    <Bar dataKey="PINBASED"  name="PIN-Based" stackId="g" fill={GW_COLORS.PINBASED} />
                    <Bar dataKey="INAPP"     name="In-App"    stackId="g" fill={GW_COLORS.INAPP} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
