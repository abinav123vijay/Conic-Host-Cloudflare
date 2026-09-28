'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

const ownerLinks=[
  ['/overview','Overview'],
  ['/dashboard/monthly','Monthly Dashboard'],['/dashboard/yearly','Yearly Dashboard'],
  ['/entries/daily','Daily Sales & Expenses'],['/entries/purchases','Weekly Purchases'],
  ['/settings','Settings'],['/import-export','Excel Import / Export']
] as const satisfies ReadonlyArray<readonly [Route, string]>;
const staffLinks=[
  ['/entries/daily','Daily Sales & Expenses'],['/entries/purchases','Weekly Purchases']
] as const satisfies ReadonlyArray<readonly [Route, string]>;
export default function Shell({children}:{children:React.ReactNode}){
  const path=usePathname(); const router=useRouter(); const [open,setOpen]=useState(false);
  const [role,setRole]=useState<'owner'|'staff'|'viewer'|null>(null);
  useEffect(()=>{fetch('/api/auth/me').then(response=>response.ok?response.json():null).then(user=>setRole(user?.role||null)).catch(()=>setRole(null))},[]);
  if (path === '/login' || path === '/signup') return <>{children}</>;
  const links=role==='owner'?ownerLinks:role==='staff'?staffLinks:[];
  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});router.replace('/login');router.refresh()};
  return <div className="app-shell">
    <aside className={`sidebar ${open?'open':''}`}>
      <div className="brand"><div className="brand-mark">C</div><div><strong>CONIC</strong><span>Business System</span></div></div>
      <nav>{links.map(([href,label])=><Link key={href} href={href} onClick={()=>setOpen(false)} className={path.startsWith(href)?'active':''}>{label}</Link>)}</nav>
      <div className="sidebar-footer">MongoDB-backed • Multi-device</div>
    </aside>
    <div className="backdrop" onClick={()=>setOpen(false)} />
    <main className="main"><header className="topbar"><button className="menu" onClick={()=>setOpen(true)}>☰</button><div><div className="eyebrow">CONIC</div><div className="page-title">Business Tracker</div></div><div className="top-actions"><span className="sync-dot"/> Cloud database <button className="logout-button" onClick={logout}>Sign out</button></div></header>{children}</main>
  </div>
}
