import { useState, useCallback } from "react";
import Papa from "papaparse";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart
} from "recharts";

const GW_COLORS = { METROBANK: "#1a56db", PINBASED: "#e3a008", INAPP: "#0e9f6e" };
const GW_LABELS = { METROBANK: "Metrobank", PINBASED: "PIN-Based", INAPP: "In-App" };

// ── Process raw CSV rows ────────────────────────────────────────────────────
function processData(rawRows) {
  const success = rawRows
    .filter(r => (r.transactionstatus || "").toUpperCase() === "SUCCESS")
    .map(r => ({ ...r, _date: new Date(r.created) }))
    .sort((a, b) => a._date - b._date);

  const userCount = {};
  success.forEach(r => {
    userCount[r.initiatedby] = (userCount[r.initiatedby] || 0) + 1;
    r.tx_rank = userCount[r.initiatedby];
    r.type = r.tx_rank > 1 ? "Renewal" : "New";
    r.month_key = r._date.toISOString().slice(0, 7);
    r.month = r._date.toLocaleString("default", { month: "short", year: "numeric" });
  });

  const dateFrom = new Date("2025-06-19");
  const dates = success.map(r => r._date);
  const dateTo = dates.length ? new Date(Math.max(...dates)) : new Date();

  const monthMap = {};
  success.forEach(r => {
    const k = r.month_key;
    if (!monthMap[k]) monthMap[k] = {
      month_key: k, month: r.month,
      total: 0, renewals: 0, new_subs: 0,
      METROBANK: 0, PINBASED: 0, INAPP: 0,
      renewal_METROBANK: 0, renewal_PINBASED: 0, renewal_INAPP: 0,
    };
    const m = monthMap[k];
    m.total++;
    const gw = (r.gwprovider || "").toUpperCase();
    if (r.type === "Renewal") {
      m.renewals++;
      if (gw === "METROBANK") m.renewal_METROBANK++;
      if (gw === "PINBASED")  m.renewal_PINBASED++;
      if (gw === "INAPP")     m.renewal_INAPP++;
    } else {
      m.new_subs++;
    }
    if (gw === "METROBANK") m.METROBANK++;
    if (gw === "PINBASED")  m.PINBASED++;
    if (gw === "INAPP")     m.INAPP++;
  });

  const monthly = Object.values(monthMap).sort((a, b) => a.month_key.localeCompare(b.month_key));
  const totals = monthly.reduce((acc, m) => ({
    total:    acc.total    + m.total,
    renewals: acc.renewals + m.renewals,
    new_subs: acc.new_subs + m.new_subs,
    METROBANK: acc.METROBANK + m.METROBANK,
    PINBASED:  acc.PINBASED  + m.PINBASED,
    INAPP:     acc.INAPP     + m.INAPP,
    renewal_METROBANK: acc.renewal_METROBANK + m.renewal_METROBANK,
    renewal_PINBASED:  acc.renewal_PINBASED  + m.renewal_PINBASED,
    renewal_INAPP:     acc.renewal_INAPP     + m.renewal_INAPP,
  }), { total:0,renewals:0,new_subs:0,METROBANK:0,PINBASED:0,INAPP:0,renewal_METROBANK:0,renewal_PINBASED:0,renewal_INAPP:0 });

  const cycleMap = {};
  success.filter(r => r.type === "Renewal").forEach(r => {
    const cycle = `Renewal ${r.tx_rank - 1}`;
    cycleMap[cycle] = (cycleMap[cycle] || 0) + 1;
  });
  const cycles = Object.entries(cycleMap)
    .sort((a, b) => parseInt(a[0].split(" ")[1]) - parseInt(b[0].split(" ")[1]))
    .slice(0, 8).map(([name, value]) => ({ name, value }));

  const uniqueCustomers = new Set(success.map(r => r.initiatedby)).size;

  return { success, monthly, totals, cycles, uniqueCustomers, dateFrom, dateTo };
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = n => (n || 0).toLocaleString();
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const fmtDate = d => d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background:"#fff", borderRadius:12, padding:"16px 18px",
      boxShadow:"0 1px 4px rgba(0,0,0,0.08)", borderTop:`4px solid ${color}` }}>
      <div style={{ fontSize:22 }}>{icon}</div>
      <div style={{ fontSize:26, fontWeight:800, color, marginTop:4 }}>{value}</div>
      <div style={{ fontSize:12, fontWeight:600, color:"#374151", marginTop:2 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#1e293b", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#f8fafc" }}>
      <div style={{ fontWeight:700, marginBottom:6, color:"#94a3b8" }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ display:"flex", justifyContent:"space-between", gap:12, marginBottom:2 }}>
          <span style={{ color:p.color }}>{p.name}</span>
          <span style={{ fontWeight:700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function Badge({ color, bg, children }) {
  return <span style={{ background:bg, color, padding:"2px 10px", borderRadius:12, fontSize:11, fontWeight:700 }}>{children}</span>;
}

// ── MAIN ───────────────────────────────────────────────────────────────────
export default function App() {
  const [data,     setData]     = useState(null);
  const [fileName, setFileName] = useState("");
  const [tab,      setTab]      = useState("overview");
  const [dragging, setDragging] = useState(false);
  const [gwFilter, setGwFilter] = useState("ALL");
  const [moFilter, setMoFilter] = useState("ALL");

  const load = (file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: ({ data: rows }) => {
        setData(processData(rows));
        setFileName(file.name);
        setTab("overview");
        setGwFilter("ALL");
        setMoFilter("ALL");
      }
    });
  };

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) load(f);
  }, []);

  // ── Empty / upload screen ──
  if (!data) return (
    <div style={{ fontFamily:"'Inter',sans-serif", minHeight:"100vh", background:"#f1f5f9",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ fontSize:52 }}>📊</div>
      <h2 style={{ margin:0, color:"#1e293b", fontSize:22 }}>Payment Renewal Dashboard</h2>
      <p style={{ color:"#64748b", margin:0, fontSize:14 }}>Upload your Payment Report CSV to get started</p>
      <div
        onDragOver={e=>{ e.preventDefault(); setDragging(true); }}
        onDragLeave={()=>setDragging(false)}
        onDrop={onDrop}
        style={{ border:`2px dashed ${dragging?"#3b82f6":"#94a3b8"}`, borderRadius:16,
          padding:"44px 70px", textAlign:"center", background:dragging?"#eff6ff":"#fff",
          transition:"all .2s", marginTop:8 }}
      >
        <div style={{ fontSize:36, marginBottom:10 }}>📂</div>
        <div style={{ fontSize:15, fontWeight:700, color:"#374151" }}>Drag & drop your CSV here</div>
        <div style={{ fontSize:13, color:"#94a3b8", margin:"8px 0 16px" }}>or click below to choose a file</div>
        <label style={{ background:"#1a56db", color:"#fff", padding:"10px 24px", borderRadius:8,
          fontSize:13, fontWeight:700, cursor:"pointer", display:"inline-block" }}>
          Choose File
          <input type="file" accept=".csv" style={{ display:"none" }}
            onChange={e=>{ if(e.target.files[0]) load(e.target.files[0]); }} />
        </label>
        <div style={{ marginTop:16, fontSize:11, color:"#cbd5e1" }}>
          Required columns: <code>initiatedby · transactionstatus · gwprovider · created · amount · paymentid</code>
        </div>
      </div>
    </div>
  );

  const { monthly, totals, cycles, uniqueCustomers, dateFrom, dateTo, success } = data;
  const trend = monthly.map(m => ({ ...m, month: m.month.replace(" 20", " '") }));

  const renewalRows = success.filter(r => {
    if (r.type !== "Renewal") return false;
    const gw = (r.gwprovider || "").toUpperCase();
    if (gwFilter !== "ALL" && gw !== gwFilter) return false;
    if (moFilter !== "ALL" && r.month_key !== moFilter) return false;
    return true;
  });

  const tabs = ["overview", "renewals", "gateway", "customers"];

  return (
    <div style={{ fontFamily:"'Inter',sans-serif", background:"#f1f5f9", minHeight:"100vh", color:"#1e293b" }}>

      {/* HEADER */}
      <div style={{ background:"#1e293b", padding:"14px 28px", display:"flex", alignItems:"center",
        justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:800, color:"#f8fafc" }}>💳 Payment Renewal Dashboard</h1>
          <p style={{ margin:"3px 0 0", fontSize:11, color:"#94a3b8" }}>
            {fileName} &nbsp;·&nbsp; {fmtDate(dateFrom)} → {fmtDate(dateTo)} &nbsp;·&nbsp; SUCCESS transactions only
          </p>
        </div>
        <label style={{ background:"#3b82f6", color:"#fff", padding:"9px 18px", borderRadius:8,
          fontSize:13, fontWeight:700, cursor:"pointer" }}>
          📂 Upload New CSV
          <input type="file" accept=".csv" style={{ display:"none" }}
            onChange={e=>{ if(e.target.files[0]) load(e.target.files[0]); }} />
        </label>
      </div>

      {/* DATE BANNER */}
      <div style={{ background:"#0f172a", padding:"8px 28px", display:"flex", gap:28, fontSize:12, color:"#94a3b8", flexWrap:"wrap" }}>
        <span>📅 <b style={{ color:"#f8fafc" }}>From:</b> {fmtDate(dateFrom)} (fixed)</span>
        <span>📅 <b style={{ color:"#f8fafc" }}>To:</b> {fmtDate(dateTo)} (latest in file)</span>
        <span>👥 <b style={{ color:"#f8fafc" }}>{fmt(uniqueCustomers)}</b> unique customers</span>
        <span>✅ <b style={{ color:"#f8fafc" }}>{fmt(totals.total)}</b> successful transactions</span>
      </div>

      {/* TABS */}
      <div style={{ display:"flex", gap:2, padding:"14px 28px 0", background:"#fff", borderBottom:"1px solid #e2e8f0" }}>
        {tabs.map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:"8px 20px", border:"none", cursor:"pointer", fontSize:13, fontWeight:700,
            textTransform:"capitalize", background:"transparent",
            color: tab===t ? "#1a56db" : "#64748b",
            borderBottom: tab===t ? "2px solid #1a56db" : "2px solid transparent",
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding:"24px 28px" }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:14, marginBottom:22 }}>
              <StatCard label="Total SUCCESS" value={fmt(totals.total)} color="#1a56db" icon="📊" />
              <StatCard label="Renewals" value={fmt(totals.renewals)} sub={`${pct(totals.renewals,totals.total)}% of total`} color="#7c3aed" icon="🔄" />
              <StatCard label="New Subscriptions" value={fmt(totals.new_subs)} sub={`${pct(totals.new_subs,totals.total)}% of total`} color="#0891b2" icon="✨" />
              <StatCard label="Unique Customers" value={fmt(uniqueCustomers)} color="#0e9f6e" icon="👥" />
            </div>

            <div style={{ background:"#fff", borderRadius:12, padding:20, marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 4px", fontSize:14, fontWeight:700 }}>Monthly Transactions — Renewal vs New</h3>
              <p style={{ margin:"0 0 16px", fontSize:12, color:"#64748b" }}>SUCCESS only · Renewal = same customer's 2nd+ successful payment</p>
              <ResponsiveContainer width="100%" height={250}>
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
              <h3 style={{ margin:"0 0 14px", fontSize:14, fontWeight:700 }}>Monthly Summary Table</h3>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#f8fafc" }}>
                      {["Month","Total","New Subs","Renewals","Renewal %","Metrobank","PIN-Based","In-App"].map(h=>(
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontWeight:700, color:"#374151", fontSize:12, borderBottom:"2px solid #e2e8f0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m,i)=>(
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
                        <td style={{ padding:"9px 12px", color:GW_COLORS.METROBANK, fontWeight:700 }}>{m.METROBANK}</td>
                        <td style={{ padding:"9px 12px", color:GW_COLORS.PINBASED,  fontWeight:700 }}>{m.PINBASED}</td>
                        <td style={{ padding:"9px 12px", color:GW_COLORS.INAPP,     fontWeight:700 }}>{m.INAPP}</td>
                      </tr>
                    ))}
                    <tr style={{ background:"#1e293b", color:"#f8fafc", fontWeight:800 }}>
                      <td style={{ padding:"9px 12px" }}>TOTAL</td>
                      <td style={{ padding:"9px 12px" }}>{totals.total}</td>
                      <td style={{ padding:"9px 12px" }}>{totals.new_subs}</td>
                      <td style={{ padding:"9px 12px" }}>{totals.renewals}</td>
                      <td style={{ padding:"9px 12px" }}>{pct(totals.renewals,totals.total)}%</td>
                      <td style={{ padding:"9px 12px", color:"#93c5fd" }}>{totals.METROBANK}</td>
                      <td style={{ padding:"9px 12px", color:"#fcd34d" }}>{totals.PINBASED}</td>
                      <td style={{ padding:"9px 12px", color:"#6ee7b7" }}>{totals.INAPP}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── RENEWALS ── */}
        {tab === "renewals" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:14, marginBottom:22 }}>
              <StatCard label="Total Renewals" value={fmt(totals.renewals)} color="#7c3aed" icon="🔄" />
              <StatCard label="via Metrobank"  value={fmt(totals.renewal_METROBANK)} sub={`${pct(totals.renewal_METROBANK,totals.renewals)}% of renewals`} color={GW_COLORS.METROBANK} icon="🏦" />
              <StatCard label="via PIN-Based"  value={fmt(totals.renewal_PINBASED)}  sub={`${pct(totals.renewal_PINBASED,totals.renewals)}% of renewals`}  color={GW_COLORS.PINBASED}  icon="🔢" />
              <StatCard label="via In-App"     value={fmt(totals.renewal_INAPP)}     sub={`${pct(totals.renewal_INAPP,totals.renewals)}% of renewals`}     color={GW_COLORS.INAPP}     icon="📱" />
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:18, marginBottom:18 }}>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Renewals by Month & Gateway</h3>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize:10 }} />
                    <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
                    <Tooltip content={<Tip />} />
                    <Legend wrapperStyle={{ fontSize:12 }} />
                    <Bar dataKey="renewal_METROBANK" name="Metrobank" stackId="r" fill={GW_COLORS.METROBANK} />
                    <Bar dataKey="renewal_PINBASED"  name="PIN-Based" stackId="r" fill={GW_COLORS.PINBASED} />
                    <Bar dataKey="renewal_INAPP"     name="In-App"    stackId="r" fill={GW_COLORS.INAPP} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 8px", fontSize:14, fontWeight:700 }}>Renewal Cycle Depth</h3>
                <p style={{ margin:"0 0 14px", fontSize:11, color:"#94a3b8" }}>How many times customers renewed</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={cycles} layout="vertical" barSize={14}>
                    <XAxis type="number" tick={{ fontSize:11 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize:11 }} width={72} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="value" name="Customers" fill="#7c3aed" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Renewal table with filters */}
            <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginBottom:14 }}>
                <h3 style={{ margin:0, fontSize:14, fontWeight:700, flex:1 }}>Renewal Transactions</h3>
                <select value={gwFilter} onChange={e=>setGwFilter(e.target.value)}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
                  <option value="ALL">All Gateways</option>
                  <option value="METROBANK">Metrobank</option>
                  <option value="PINBASED">PIN-Based</option>
                  <option value="INAPP">In-App</option>
                </select>
                <select value={moFilter} onChange={e=>setMoFilter(e.target.value)}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
                  <option value="ALL">All Months</option>
                  {monthly.map(m=><option key={m.month_key} value={m.month_key}>{m.month}</option>)}
                </select>
                <span style={{ fontSize:12, color:"#94a3b8" }}>{renewalRows.length} records</span>
              </div>
              <div style={{ overflowX:"auto", maxHeight:380, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead style={{ position:"sticky", top:0 }}>
                    <tr style={{ background:"#1e293b", color:"#f8fafc" }}>
                      {["Payment ID","Customer ID","Renewal #","Gateway","Amount","Date"].map(h=>(
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {renewalRows.map((r,i)=>(
                      <tr key={i} style={{ background:i%2===0?"#fff":"#f8fafc", borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"7px 12px", color:"#64748b" }}>{r.paymentid}</td>
                        <td style={{ padding:"7px 12px", fontFamily:"monospace", fontSize:11 }}>{r.initiatedby}</td>
                        <td style={{ padding:"7px 12px" }}><Badge color="#6d28d9" bg="#ede9fe">#{r.tx_rank-1}</Badge></td>
                        <td style={{ padding:"7px 12px" }}>
                          <Badge color={GW_COLORS[(r.gwprovider||"").toUpperCase()]} bg={GW_COLORS[(r.gwprovider||"").toUpperCase()]+"22"}>
                            {GW_LABELS[(r.gwprovider||"").toUpperCase()]||r.gwprovider}
                          </Badge>
                        </td>
                        <td style={{ padding:"7px 12px", fontWeight:700 }}>₱{Number(r.amount||0).toLocaleString()}</td>
                        <td style={{ padding:"7px 12px", color:"#64748b", whiteSpace:"nowrap" }}>
                          {r._date.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"})}
                        </td>
                      </tr>
                    ))}
                    {renewalRows.length===0 && (
                      <tr><td colSpan={6} style={{ textAlign:"center", padding:32, color:"#94a3b8" }}>No records match the filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── GATEWAY ── */}
        {tab === "gateway" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:22 }}>
              {["METROBANK","PINBASED","INAPP"].map(gw=>(
                <StatCard key={gw} label={GW_LABELS[gw]} value={fmt(totals[gw])}
                  sub={`${pct(totals[gw],totals.total)}% of SUCCESS`}
                  color={GW_COLORS[gw]} icon={gw==="METROBANK"?"🏦":gw==="PINBASED"?"🔢":"📱"} />
              ))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <h3 style={{ margin:"0 0 16px", fontSize:14, fontWeight:700 }}>Gateway Share</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={[
                      { name:"Metrobank", value:totals.METROBANK },
                      { name:"PIN-Based", value:totals.PINBASED },
                      { name:"In-App",    value:totals.INAPP },
                    ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                      label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>
                      {["METROBANK","PINBASED","INAPP"].map(gw=><Cell key={gw} fill={GW_COLORS[gw]} />)}
                    </Pie>
                    <Tooltip />
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
                    <Tooltip content={<Tip />} />
                    <Legend wrapperStyle={{ fontSize:12 }} />
                    <Bar dataKey="METROBANK" name="Metrobank" stackId="g" fill={GW_COLORS.METROBANK} />
                    <Bar dataKey="PINBASED"  name="PIN-Based" stackId="g" fill={GW_COLORS.PINBASED} />
                    <Bar dataKey="INAPP"     name="In-App"    stackId="g" fill={GW_COLORS.INAPP} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ── CUSTOMERS ── */}
        {tab === "customers" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:14, marginBottom:22 }}>
              <StatCard label="Unique Customers" value={fmt(uniqueCustomers)} color="#0e9f6e" icon="👥" />
              <StatCard label="Renewed at least once" value={fmt(new Set(success.filter(r=>r.tx_rank===2).map(r=>r.initiatedby)).size)} color="#7c3aed" icon="🔄" />
              <StatCard label="Renewed 5+ times" value={fmt(new Set(success.filter(r=>r.tx_rank>=6).map(r=>r.initiatedby)).size)} sub="loyal customers" color="#f97316" icon="⭐" />
            </div>
            <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin:"0 0 14px", fontSize:14, fontWeight:700 }}>Top Renewing Customers</h3>
              <div style={{ overflowX:"auto", maxHeight:500, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead style={{ position:"sticky", top:0 }}>
                    <tr style={{ background:"#1e293b", color:"#f8fafc" }}>
                      {["#","Customer ID","Total Payments","Renewals","Gateways Used","First Payment","Last Payment"].map(h=>(
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(
                      success.reduce((acc,r)=>{
                        if(!acc[r.initiatedby]) acc[r.initiatedby]={ id:r.initiatedby, total:0, renewals:0, gateways:new Set(), first:r._date, last:r._date };
                        const c=acc[r.initiatedby];
                        c.total++;
                        if(r.type==="Renewal") c.renewals++;
                        c.gateways.add(GW_LABELS[(r.gwprovider||"").toUpperCase()]||r.gwprovider);
                        if(r._date<c.first) c.first=r._date;
                        if(r._date>c.last)  c.last=r._date;
                        return acc;
                      },{})
                    ).sort((a,b)=>b.renewals-a.renewals).slice(0,100)
                    .map((c,i)=>(
                      <tr key={c.id} style={{ background:i%2===0?"#fff":"#f8fafc", borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"7px 12px", color:"#94a3b8", fontWeight:700 }}>{i+1}</td>
                        <td style={{ padding:"7px 12px", fontFamily:"monospace", fontSize:11 }}>{c.id}</td>
                        <td style={{ padding:"7px 12px", fontWeight:700 }}>{c.total}</td>
                        <td style={{ padding:"7px 12px" }}><Badge color="#6d28d9" bg="#ede9fe">{c.renewals}x</Badge></td>
                        <td style={{ padding:"7px 12px", color:"#64748b" }}>{[...c.gateways].join(", ")}</td>
                        <td style={{ padding:"7px 12px", color:"#64748b", whiteSpace:"nowrap" }}>{fmtDate(c.first)}</td>
                        <td style={{ padding:"7px 12px", color:"#64748b", whiteSpace:"nowrap" }}>{fmtDate(c.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
