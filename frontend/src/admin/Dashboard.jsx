import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAdmin } from '../lib/useAdmin.js';
import { PageHead, Spinner, Notice, EmptyState } from './ui.jsx';
import { ChartCard, LineChart, Donut, StackedBars, Bars, Columns, Heatmap, Stat, SERIES } from './charts.jsx';
import { abbreviateVenue } from '../lib/abbreviate.js';

const shortDate = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const longDate = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const describeEx = e => (e.type === 'holiday' ? `Holiday — ${e.label}`
  : e.type === 'cancel' ? `${e.batch} · ${e.subject} cancelled${e.label ? ` (${e.label})` : ''}`
  : `${e.toTrainer} covers ${e.fromTrainer} · ${e.batch}`);
const ACTION = { create: 'created', update: 'updated', delete: 'deleted', import: 'imported', login: 'signed in', login_failed: 'failed sign-in', password: 'changed password', notify: 'sent' };

/*
 * The console's landing page: everything on the timetable at a glance.
 * Weekly figures describe the week as it runs now; the trend walks real dates,
 * so batch start/end dates, holidays and cancellations all show up in it.
 */
export default function Dashboard() {
  const { can } = useAdmin();
  const [a, setA] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => Promise.all([api.analytics(), api.schedule()])
      .then(([x, s]) => { setA(x); setData(s); setError(''); })
      .catch(e => setError(e.message));
    load();
    addEventListener('schedule:changed', load);
    return () => removeEventListener('schedule:changed', load);
  }, []);

  if (error && !a) return <><PageHead title="Dashboard" /><Notice error={error} /></>;
  if (!a || !data) return <><PageHead title="Dashboard" /><Spinner /></>;

  const k = a.kpis;
  const live = data.batches.filter(b => b.status !== 'ended');
  const unassigned = live.filter(b => b.rows.some(r => !r.mainList.length));
  const noVenue = live.filter(b => b.rows.some(r => !r.venue));
  const attention = [...new Set([...unassigned, ...noVenue])];
  const idOf = Object.fromEntries(data.batches.map(b => [b.name, b.id]));
  const editLink = name => `/admin/batches?edit=${encodeURIComponent(idOf[name] || '')}`;

  const trendPoints = a.trend.map(t => ({ label: `Week of ${shortDate(t.week)}`, short: shortDate(t.week), values: [t.periods, t.cancelled] }));
  const markIndex = a.trend.findIndex(t => t.current);
  const series2 = [{ label: 'Periods held', color: 'var(--viz-2)' }, { label: 'Cancelled', color: 'var(--viz-4)', dashed: true }];
  const loadSeries = [{ label: 'Main mentor', color: SERIES[0] }, { label: 'Support', color: SERIES[2] }, { label: 'Assigned work', color: SERIES[3] }];
  const topLoad = a.trainerLoad.slice(0, 12);
  const groupData = a.byGroup.length <= 4
    ? a.byGroup.map((g, i) => ({ label: g.group, value: g.periods, color: SERIES[i] }))
    : [...a.byGroup.slice(0, 3).map((g, i) => ({ label: g.group, value: g.periods, color: SERIES[i] })),
      { label: 'Other', value: a.byGroup.slice(3).reduce((n, g) => n + g.periods, 0), color: SERIES[3] }];
  const statusData = [
    { label: 'Running now', value: a.batchStatus.current || 0, color: SERIES[0] },
    { label: 'Starting later', value: a.batchStatus.upcoming || 0, color: SERIES[2] },
    { label: 'Finished', value: a.batchStatus.ended || 0, color: SERIES[3] },
  ];
  const todayIdx = a.days.indexOf(new Date().toLocaleDateString('en-US', { weekday: 'long' }));

  return (
    <>
      <PageHead
        title="Dashboard"
        blurb={`The whole timetable at a glance · ${longDate(a.today)}. Weekly figures are this week as it runs; the trend applies real dates, holidays and cancellations.`}
      />

      {!!a.conflicts.length && (
        <div className="conflict">
          <h3>{a.conflicts.length} scheduling clash{a.conflicts.length > 1 ? 'es' : ''} to resolve</h3>
          <ul>
            {a.conflicts.map((c, i) => (
              <li key={i}>
                <b>{c.subject}</b>{c.kind === 'trainer' ? ' is booked twice' : ' is double-booked'} on {c.day} at {c.slot} — {c.batches.map((name, j) => (
                  <span key={name}>{j ? ' and ' : ''}<Link to={editLink(name)} className="clash-link">{name}</Link></span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="kpis">
        <Stat hero label="Class periods this week" value={k.weeklyPeriods} sub={`across ${k.activeBatches} running batch${k.activeBatches === 1 ? '' : 'es'} · ${k.students.toLocaleString('en-IN')} students`} />
        <Stat label="Batches" value={k.activeBatches} sub={`${k.upcomingBatches} starting later · ${k.endedBatches} finished`} />
        <Stat label="Trainers" value={k.trainers} sub={`${k.teaching} teaching · ${k.nonTeaching} non-teaching`} />
        <Stat label="Hall utilisation" value={`${k.hallUtilization}%`} sub={`${k.halls} halls, lunch excluded`} />
        <Stat label="Teaching staff utilisation" value={`${k.trainerUtilization}%`} sub={k.idleTrainers ? `${k.idleTrainers} teaching trainer${k.idleTrainers === 1 ? '' : 's'} with no classes` : 'every teaching trainer has classes'} />
        <Stat label="Needs attention" value={k.unstaffed + k.noHall} sub={`${k.unstaffed} without a mentor · ${k.noHall} without a hall`} />
        <Stat label="Next 30 days" value={k.exceptionsNext30} sub={`date change${k.exceptionsNext30 === 1 ? '' : 's'} · ${k.holidaysNext30} holiday${k.holidaysNext30 === 1 ? '' : 's'}`} />
      </div>

      <div className="dash-grid">
        <ChartCard className="span-8" title="Class periods per week"
          sub="Four weeks back to eleven ahead. Batch dates, holidays and cancellations applied."
          legend={series2}
          table={{ columns: ['Week of', 'Periods held', 'Cancelled', 'Holiday days'], rows: a.trend.map(t => [shortDate(t.week), t.periods, t.cancelled, t.holidayDays]) }}>
          <LineChart points={trendPoints} series={series2} markIndex={markIndex} />
        </ChartCard>

        <ChartCard className="span-4" title="Weekly periods by year"
          sub="Share of this week's class periods."
          table={{ columns: ['Year group', 'Periods', 'Batches', 'Students'], rows: a.byGroup.map(g => [g.group, g.periods, g.batches, g.students]) }}>
          <Donut data={groupData} centerLabel="periods" />
        </ChartCard>

        <ChartCard className="span-7" title="Trainer workload"
          sub={`Periods per week, busiest first${a.trainerLoad.length > 12 ? ` (top 12 of ${a.trainerLoad.length})` : ''}. Full list under Workload.`}
          legend={loadSeries}
          actions={<Link className="chart-toggle" to="/admin/workload">Workload</Link>}
          table={{ columns: ['Trainer', 'Main', 'Support', 'Assigned', 'Total', 'Utilisation %'], rows: a.trainerLoad.map(t => [t.name, t.main, t.support, t.assigned, t.total, t.utilization]) }}>
          <StackedBars rows={topLoad.map(t => ({ label: t.name, parts: [t.main, t.support, t.assigned] }))} series={loadSeries} />
        </ChartCard>

        <div className="span-5 stack-col">
        <ChartCard title="Hall utilisation"
          sub="Share of each hall's teaching periods booked this week."
          table={{ columns: ['Hall', 'Booked', 'Available', 'Utilisation %'], rows: a.hallUsage.map(h => [h.name, h.used, h.available, h.utilization]) }}>
          <Bars rows={a.hallUsage.map(h => ({ label: abbreviateVenue(h.name), value: h.utilization, tip: [[h.name, ''], ['Booked', `${h.used} of ${h.available} periods`], ['Utilisation', `${h.utilization}%`]] }))}
            max={100} suffix="%" labelWidth={110} />
        </ChartCard>

        <ChartCard title="Batch status"
          sub="Every batch on file, by its dates."
          table={{ columns: ['Status', 'Batches'], rows: statusData.map(s => [s.label, s.value]) }}>
          <Donut data={statusData} centerLabel="batches" />
        </ChartCard>
        </div>

        <ChartCard className="span-7" title="When classes run"
          sub="Classes in each period this week — darker is busier."
          table={{ columns: ['Day', ...a.slots.map((s, i) => `${i + 1} (${s})`)], rows: a.days.map((d, i) => [d, ...a.heatmap.cells[i]]) }}>
          <Heatmap rows={a.days} cols={a.slots} cells={a.heatmap.cells} max={a.heatmap.max} skipCol={a.lunchIndex} />
        </ChartCard>

        <ChartCard className="span-5" title="Periods per weekday"
          sub="How the week's teaching load spreads across days."
          table={{ columns: ['Day', 'Periods', 'Classes'], rows: a.byDay.map(d => [d.day, d.periods, d.classes]) }}>
          <Columns data={a.byDay.map(d => ({ label: d.day, short: d.day.slice(0, 3), value: d.periods, tip: [['Periods', d.periods], ['Classes', d.classes]] }))} highlight={todayIdx} />
        </ChartCard>

        {/* left two-thirds: top subjects, with what is coming up beneath it;
            right third: recent activity alongside both */}
        <div className="span-8 stack-col fit">
        <ChartCard title="Top subjects"
          sub="Weekly class periods per subject, most taught first."
          table={{ columns: ['Subject', 'Periods per week'], rows: a.topSubjects.map(s => [s.subject, s.periods]) }}>
          <Bars rows={a.topSubjects.map(s => ({ label: s.subject, value: s.periods, tip: [['Periods per week', s.periods]] }))} labelWidth={170} fill />
        </ChartCard>

        <section className="card grow">
          <h2>Coming up · next 30 days</h2>
          <p className="sub">Holidays, cancelled classes and substitutions.</p>
          {!a.upcomingExceptions.length ? <EmptyState title="Nothing out of the ordinary">The weekly timetable runs as planned.</EmptyState> : (
            <ul className="feed">
              {a.upcomingExceptions.slice(0, 10).map((e, i) => (
                <li key={i}>
                  <span className={`feed-tag ${e.type}`}>{e.type === 'holiday' ? 'Holiday' : e.type === 'cancel' ? 'Cancelled' : 'Substitute'}</span>
                  <span className="feed-when">{longDate(e.date)}{e.endDate && e.endDate !== e.date ? ` – ${longDate(e.endDate)}` : ''}</span>
                  <span className="feed-what">{describeEx(e)}</span>
                </li>
              ))}
            </ul>
          )}
          {can('admin', 'coordinator') && <Link className="btn btn-ghost btn-sm" to="/admin/exceptions">Manage holidays & exceptions</Link>}
        </section>
        </div>

        <section className="card span-4">
          <h2>{can('admin') ? 'Recent activity' : 'Notifications'}</h2>
          <p className="sub">
            Emails in the last 7 days: <b>{a.notifications.sent}</b> sent · <b>{a.notifications.failed}</b> failed · <b>{a.notifications.skipped}</b> skipped.
          </p>
          {can('admin') && (a.recent.length ? (
            <ul className="feed">
              {a.recent.map(r => (
                <li key={r._id}>
                  <span className="feed-when">{new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="feed-what"><b>{r.actor?.email || 'someone'}</b> {ACTION[r.action] || r.action} {r.entity === 'auth' ? '' : `${r.entity} `}<b>{r.name}</b></span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No changes recorded yet" />)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {can('admin') && <Link className="btn btn-ghost btn-sm" to="/admin/history">Full change history</Link>}
            <Link className="btn btn-ghost btn-sm" to="/admin/notifications">Notification log</Link>
          </div>
        </section>
      </div>

      <div className="card">
        <h2>Needs attention</h2>
        <p className="sub">Running and upcoming batches with a class that has no main mentor or no hall.</p>
        {!attention.length ? (
          <EmptyState title="Everything is assigned">Every class has a mentor and a hall.</EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl stack">
              <thead><tr><th>Batch</th><th>Year</th><th>Missing</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {attention.map(b => {
                  const gaps = [];
                  if (b.rows.some(r => !r.mainList.length)) gaps.push('main mentor');
                  if (b.rows.some(r => !r.venue)) gaps.push('training hall');
                  return (
                    <tr key={b.id}>
                      <td className="nm" data-label="Batch">{b.name}</td>
                      <td className="muted" data-label="Year">{b.group}</td>
                      <td data-label="Missing">{gaps.map(g => <span className="pill-tag warn" key={g} style={{ marginRight: 6 }}>{g}</span>)}</td>
                      <td className="act"><Link className="btn btn-ghost btn-sm" to={editLink(b.name)} aria-label={`Open ${b.name} to fix it`}>Fix</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
