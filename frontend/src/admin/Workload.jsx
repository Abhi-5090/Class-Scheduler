import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.jsx';
import { PageHead, Spinner, Notice, useTable, SortTh, SearchBox } from './ui.jsx';
import { ChartCard, StackedBars, Bars, Heatmap, Meter, Stat, SERIES } from './charts.jsx';

const loadSeries = [{ label: 'Main mentor', color: SERIES[0] }, { label: 'Support', color: SERIES[2] }, { label: 'Assigned work', color: SERIES[3] }];

/*
 * Workload and utilisation in detail: every trainer's weekly periods split by
 * role, every hall's booked share, and the day × period heatmap — sortable,
 * searchable and exportable to Excel or CSV.
 */
export default function Workload() {
  const { toast } = useFeedback();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [track, setTrack] = useState('all');

  useEffect(() => {
    const load = () => api.analytics().then(setA).catch(e => setError(e.message));
    load();
    addEventListener('schedule:changed', load);
    return () => removeEventListener('schedule:changed', load);
  }, []);

  const rows = (a?.trainerLoad || []).filter(t => track === 'all' || t.track === (track === 'teaching' ? 'Teaching' : 'Non-Teaching'));
  const table = useTable(rows, {
    text: t => t.name,
    sorts: { name: t => t.name, track: t => t.track, main: t => t.main, support: t => t.support, assigned: t => t.assigned, total: t => t.total, free: t => t.free, util: t => t.utilization },
    initial: 'total', initialDir: 'desc',
  });

  if (error && !a) return <><PageHead title="Workload & Utilisation" /><Notice error={error} /></>;
  if (!a) return <><PageHead title="Workload & Utilisation" /><Spinner /></>;

  /* teaching periods in a week: every period on every day, less the lunch row if there is one */
  const hasLunch = a.lunchIndex >= 0 && a.lunchIndex < a.slots.length;
  const capacity = a.days.length * (a.slots.length - (hasLunch ? 1 : 0));
  const avg = rows.length ? Math.round((rows.reduce((n, t) => n + t.total, 0) / rows.length) * 10) / 10 : 0;
  const busiest = rows[0];

  const trainerCols = [
    { key: 'name', label: 'Trainer' }, { key: 'track', label: 'Track' }, { key: 'main', label: 'Main periods' },
    { key: 'support', label: 'Support periods' }, { key: 'assigned', label: 'Assigned work periods' }, { key: 'total', label: 'Total periods' },
    { key: 'free', label: 'Free periods' }, { key: 'capacity', label: 'Weekly teaching periods' }, { key: 'utilization', label: 'Utilisation %' },
  ];
  const hallCols = [
    { key: 'name', label: 'Hall' }, { key: 'capacity', label: 'Seats' }, { key: 'used', label: 'Booked periods' },
    { key: 'available', label: 'Available periods' }, { key: 'utilization', label: 'Utilisation %' },
  ];
  const trainerRows = () => a.trainerLoad.map(t => ({ ...t, capacity }));

  /* Excel: one workbook, a sheet each. CSV holds one table, so one file per button. */
  const exportBook = async () => {
    try {
      const { downloadBook } = await import('../lib/sheets.js');
      await downloadBook([{ name: 'Trainer workload', rows: trainerRows(), columns: trainerCols }, { name: 'Hall utilisation', rows: a.hallUsage, columns: hallCols }], 'Workload_and_utilisation');
      toast('Workload workbook downloaded');
    } catch (e) { toast(e.message, 'error'); }
  };
  const exportCsv = async which => {
    try {
      const { download } = await import('../lib/sheets.js');
      if (which === 'trainers') await download(trainerRows(), trainerCols, 'Trainer_workload', 'csv');
      else await download(a.hallUsage, hallCols, 'Hall_utilisation', 'csv');
      toast('Downloaded');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead
        title="Workload & Utilisation"
        blurb={`Weekly periods per trainer and per hall, for the week as it runs now. A full teaching week is ${capacity} periods (${a.days.length} days × ${a.slots.length - (hasLunch ? 1 : 0)} periods${hasLunch ? ', lunch excluded' : ''}).`}
      >
        <button type="button" className="btn-pdf" onClick={exportBook}>Export Excel</button>
        <button type="button" className="btn-pdf" onClick={() => exportCsv('trainers')}>Trainers CSV</button>
        <button type="button" className="btn-pdf" onClick={() => exportCsv('halls')}>Halls CSV</button>
      </PageHead>

      <div className="kpis">
        <Stat label="Teaching staff utilisation" value={`${a.kpis.trainerUtilization}%`} sub="share of teaching periods in use" />
        <Stat label="Average load" value={avg} sub={`periods / week · ${track === 'all' ? 'all trainers' : track === 'teaching' ? 'teaching' : 'non-teaching'}`} />
        <Stat label="Busiest" value={busiest ? busiest.total : 0} sub={busiest ? `${busiest.name}` : '—'} />
        <Stat label="With no classes" value={a.kpis.idleTrainers} sub="teaching trainers" />
        <Stat label="Hall utilisation" value={`${a.kpis.hallUtilization}%`} sub={`${a.kpis.halls} halls`} />
      </div>

      <div className="card">
        <div className="admin-filter-bar">
          {['all', 'teaching', 'non-teaching'].map(t => (
            <button key={t} type="button" className={`btn btn-sm ${track === t ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={track === t} onClick={() => setTrack(t)}>
              {t === 'all' ? 'All trainers' : t === 'teaching' ? 'Teaching' : 'Non-Teaching'}
            </button>
          ))}
          <SearchBox value={table.query} onChange={table.setQuery} label="Search trainers" placeholder="Search trainer…" />
        </div>
        <div className="tbl-wrap">
          <table className="tbl stack">
            <caption className="sr-only">Trainer workload, periods per week</caption>
            <thead>
              <tr>
                <SortTh label="Trainer" k="name" table={table} />
                <SortTh label="Track" k="track" table={table} />
                <SortTh label="Main" k="main" table={table} />
                <SortTh label="Support" k="support" table={table} />
                <SortTh label="Assigned" k="assigned" table={table} />
                <SortTh label="Total" k="total" table={table} />
                <SortTh label="Free" k="free" table={table} />
                <SortTh label="Utilisation" k="util" table={table} style={{ minWidth: 170 }} />
              </tr>
            </thead>
            <tbody>
              {table.rows.map(t => (
                <tr key={t.name}>
                  <td className="nm" data-label="Trainer">{t.name}</td>
                  <td data-label="Track"><span className={`mini-track ${t.track === 'Teaching' ? 'teaching' : 'non-teaching'}`}>{t.track}</span></td>
                  <td className="mono" data-label="Main">{t.main}</td>
                  <td className="mono" data-label="Support">{t.support}</td>
                  <td className="mono" data-label="Assigned">{t.assigned}</td>
                  <td className="mono" data-label="Total"><b>{t.total}</b></td>
                  <td className="mono" data-label="Free">{t.free}</td>
                  <td data-label="Utilisation">
                    <span className="util-cell"><Meter value={t.utilization} max={100} label={`${t.name} utilisation`} /><span className="mono">{t.utilization}%</span></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dash-grid">
        <ChartCard className="span-12" title="Periods per trainer"
          sub="Main, support and assigned work, stacked."
          legend={loadSeries}
          table={{ columns: ['Trainer', 'Main', 'Support', 'Assigned', 'Total'], rows: table.rows.map(t => [t.name, t.main, t.support, t.assigned, t.total]) }}>
          <StackedBars rows={table.rows.map(t => ({ label: t.name, parts: [t.main, t.support, t.assigned] }))} series={loadSeries} max={Math.max(capacity, ...table.rows.map(t => t.total))} />
        </ChartCard>

        <ChartCard className="span-6" title="Hall utilisation"
          sub="Booked share of each hall's teaching periods."
          table={{ columns: ['Hall', 'Booked', 'Available', 'Utilisation %'], rows: a.hallUsage.map(h => [h.name, h.used, h.available, h.utilization]) }}>
          <Bars rows={a.hallUsage.map(h => ({ label: h.name, value: h.utilization, tip: [['Booked', `${h.used} of ${h.available}`], ['Utilisation', `${h.utilization}%`]] }))} max={100} suffix="%" labelWidth={170} />
        </ChartCard>

        <ChartCard className="span-6" title="Busy periods"
          sub="Classes running in each period of the week."
          table={{ columns: ['Day', ...a.slots.map((s, i) => `${i + 1}`)], rows: a.days.map((d, i) => [d, ...a.heatmap.cells[i]]) }}>
          <Heatmap rows={a.days} cols={a.slots} cells={a.heatmap.cells} max={a.heatmap.max} skipCol={a.lunchIndex} />
        </ChartCard>
      </div>
    </>
  );
}
