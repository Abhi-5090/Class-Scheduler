import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

/*
 * Small, dependency-free SVG charts for the dashboard and workload pages.
 *
 * Colour: the app is cobalt / black / white, so series use an ORDINAL cobalt
 * ramp (--viz-1 strongest … --viz-4 lightest), validated light and dark with
 * the palette checker; magnitudes (heatmap, meters) use the single cobalt hue
 * light→dark. Text never wears a series colour — identity comes from the
 * swatch beside it.
 *
 * Marks: bars ≤ 22px with 4px rounded data ends and 2px surface gaps between
 * stacked segments, 2px lines, ≥ 8px markers with a surface ring, hairline
 * gridlines. Every chart has a hover tooltip and a "Table" view with the same
 * numbers, so nothing is only readable by hovering or by colour.
 */
export const SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)'];
const fmt = n => (typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : n);

/* width of a container, kept current as it resizes */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ── tooltip shared by every chart in a card ── */
const TipCtx = createContext({ show: () => {}, hide: () => {} });
const useTip = () => useContext(TipCtx);

/*
 * The frame every chart sits in: title, one-line subtitle, legend (for two or
 * more series), a Table toggle, and the tooltip layer.
 */
export function ChartCard({ title, sub, legend, table, children, className = '', actions }) {
  const [tip, setTip] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const box = useRef(null);
  const show = (e, content) => {
    const r = box.current.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    const x = (src.clientX ?? r.left) - r.left, y = (src.clientY ?? r.top) - r.top;
    setTip({ x: Math.min(Math.max(x, 70), r.width - 70), y, content });
  };
  return (
    <section className={`card chart-card ${className}`} ref={box}>
      <header className="chart-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="chart-sub">{sub}</p>}
        </div>
        <div className="chart-actions">
          {actions}
          {table && (
            <button type="button" className="chart-toggle" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}>
              {asTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </header>
      {legend?.length > 1 && !asTable && (
        <ul className="chart-legend">
          {legend.map(l => (
            <li key={l.label}><span className={`swatch ${l.dashed ? 'dashed' : ''}`} style={{ '--c': l.color }} />{l.label}</li>
          ))}
        </ul>
      )}
      {asTable && table ? <DataTable {...table} caption={title} /> : (
        <TipCtx.Provider value={{ show, hide: () => setTip(null) }}>
          <div className="chart-body" onMouseLeave={() => setTip(null)}>{children}</div>
        </TipCtx.Provider>
      )}
      {tip && !asTable && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.content}</div>
      )}
    </section>
  );
}

export function DataTable({ columns, rows, caption }) {
  return (
    <div className="tbl-wrap chart-table">
      <table className="tbl">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'mono' : 'nm'}>{fmt(v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const Tip = ({ title, lines }) => (
  <>
    <b>{title}</b>
    {lines.map(([label, value, color], i) => (
      <span key={i} className="tip-line">{color && <i style={{ '--c': color }} />}{label}<em>{fmt(value)}</em></span>
    ))}
  </>
);

/* rounded only at the data end (right for bars), square at the baseline */
const barPath = (x, y, w, h, r = 4) => {
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
};
const colPath = (x, y, w, h, r = 4) => {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};
const niceMax = v => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/* ── horizontal stacked bars (one row per entity, parts in series order) ── */
export function StackedBars({ rows, series, unit = 'periods', labelWidth = 120, max: givenMax }) {
  const [ref, w] = useWidth();
  const { show, hide } = useTip();
  const row = 30, bar = 16, pad = 8;
  const max = givenMax || niceMax(Math.max(1, ...rows.map(r => r.parts.reduce((a, b) => a + b, 0))));
  const plot = Math.max(40, w - labelWidth - 44);
  const h = rows.length * row + 22;
  return (
    <div ref={ref} className="chart-svg">
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label={`${rows.length} rows of ${series.map(s => s.label).join(', ')}`}>
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <g key={t}>
              <line x1={labelWidth + plot * t} x2={labelWidth + plot * t} y1={0} y2={rows.length * row} className="grid" />
              <text x={labelWidth + plot * t} y={h - 6} className="tick" textAnchor="middle">{fmt(Math.round(max * t))}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = i * row + (row - bar) / 2;
            let x = labelWidth;
            const total = r.parts.reduce((a, b) => a + b, 0);
            return (
              <g key={`${i}-${r.label}`} className="hit"
                onMouseMove={e => show(e, <Tip title={r.label} lines={[...series.map((s, k) => [s.label, r.parts[k], s.color]), ['Total', total]]} />)}
                onMouseLeave={hide}>
                <rect x={0} y={i * row} width={w} height={row} fill="transparent" />
                <text x={labelWidth - pad} y={y + bar / 2 + 4} className="label" textAnchor="end">{r.label.length > 18 ? `${r.label.slice(0, 17)}…` : r.label}</text>
                {r.parts.map((v, k) => {
                  const segW = (v / max) * plot;
                  const last = r.parts.slice(k + 1).every(p => !p);
                  const d = last ? barPath(x, y, Math.max(segW - (k ? 0 : 0), 0), bar) : `M${x},${y}h${Math.max(segW - 2, 0)}v${bar}h${-Math.max(segW - 2, 0)}Z`;
                  const el = v > 0 ? <path key={k} d={d} fill={series[k].color} /> : null;
                  x += segW;
                  return el;
                })}
                <text x={x + 6} y={y + bar / 2 + 4} className="value">{total ? fmt(total) : ''}</text>
              </g>
            );
          })}
        </svg>
      )}
      <p className="sr-only">{rows.map(r => `${r.label}: ${r.parts.reduce((a, b) => a + b, 0)} ${unit}`).join('; ')}</p>
    </div>
  );
}

/* ── horizontal single-series bars, value at the tip ── */
export function Bars({ rows, color = 'var(--viz-1)', max: givenMax, suffix = '', labelWidth = 150, valueLabel = r => `${fmt(r.value)}${suffix}` }) {
  return <StackedBarsSingle rows={rows} color={color} givenMax={givenMax} labelWidth={labelWidth} valueLabel={valueLabel} suffix={suffix} />;
}
function StackedBarsSingle({ rows, color, givenMax, labelWidth, valueLabel, suffix }) {
  const [ref, w] = useWidth();
  const { show, hide } = useTip();
  const row = 30, bar = 16;
  const max = givenMax || niceMax(Math.max(1, ...rows.map(r => r.value)));
  const plot = Math.max(40, w - labelWidth - 56);
  const h = rows.length * row + 22;
  return (
    <div ref={ref} className="chart-svg">
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label={rows.map(r => `${r.label} ${valueLabel(r)}`).join(', ')}>
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={labelWidth + plot * t} x2={labelWidth + plot * t} y1={0} y2={rows.length * row} className="grid" />
              <text x={labelWidth + plot * t} y={h - 6} className="tick" textAnchor="middle">{fmt(Math.round(max * t))}{suffix}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = i * row + (row - bar) / 2, bw = (r.value / max) * plot;
            return (
              <g key={`${i}-${r.label}`} className="hit" onMouseMove={e => show(e, <Tip title={r.label} lines={r.tip || [['Value', valueLabel(r)]]} />)} onMouseLeave={hide}>
                <rect x={0} y={i * row} width={w} height={row} fill="transparent" />
                <text x={labelWidth - 8} y={y + bar / 2 + 4} className="label" textAnchor="end">{r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}</text>
                <path d={barPath(labelWidth, y, bw, bar)} fill={r.color || color} />
                <text x={labelWidth + bw + 6} y={y + bar / 2 + 4} className="value">{valueLabel(r)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* ── vertical columns ── */
export function Columns({ data, color = 'var(--viz-1)', highlight = -1, height = 200, unit = '' }) {
  const [ref, w] = useWidth();
  const { show, hide } = useTip();
  const top = 18, bottom = 26, left = 30;
  const max = niceMax(Math.max(1, ...data.map(d => d.value)));
  const band = (w - left) / Math.max(1, data.length), cw = Math.min(22, band * 0.55);
  const ph = height - top - bottom;
  return (
    <div ref={ref} className="chart-svg">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={data.map(d => `${d.label} ${d.value}${unit}`).join(', ')}>
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={left} x2={w} y1={top + ph * (1 - t)} y2={top + ph * (1 - t)} className="grid" />
              <text x={left - 6} y={top + ph * (1 - t) + 4} className="tick" textAnchor="end">{fmt(Math.round(max * t))}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const h = (d.value / max) * ph, x = left + band * i + (band - cw) / 2;
            return (
              <g key={d.label} className="hit" onMouseMove={e => show(e, <Tip title={d.label} lines={d.tip || [['Value', `${fmt(d.value)}${unit}`]]} />)} onMouseLeave={hide}>
                <rect x={left + band * i} y={top} width={band} height={ph} fill="transparent" />
                <path d={colPath(x, top + ph - h, cw, h)} fill={i === highlight ? 'var(--viz-1)' : color} opacity={highlight >= 0 && i !== highlight ? 0.55 : 1} />
                {(i === highlight || data.length <= 7) && d.value > 0 && <text x={x + cw / 2} y={top + ph - h - 5} className="value" textAnchor="middle">{fmt(d.value)}</text>}
                <text x={x + cw / 2} y={height - 8} className="tick" textAnchor="middle">{d.short || d.label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* ── line chart (one shared axis; series of the same unit only) ── */
export function LineChart({ points, series, height = 230, markIndex = -1, markLabel = 'This week' }) {
  const [ref, w] = useWidth();
  const { show, hide } = useTip();
  const [hover, setHover] = useState(-1);
  const top = 22, bottom = 28, left = 34, right = 70;
  const max = niceMax(Math.max(1, ...points.flatMap(p => p.values)));
  const pw = Math.max(60, w - left - right), ph = height - top - bottom;
  const X = i => left + (points.length < 2 ? pw / 2 : (pw * i) / (points.length - 1));
  const Y = v => top + ph - (v / max) * ph;
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left - left) / pw) * (points.length - 1))));
    setHover(i);
    const p = points[i];
    show(e, <Tip title={p.label} lines={series.map((s, k) => [s.label, p.values[k], s.color])} />);
  };
  return (
    <div ref={ref} className="chart-svg">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${series.map(s => s.label).join(' and ')} over ${points.length} weeks`}
          onMouseMove={onMove} onMouseLeave={() => { setHover(-1); hide(); }}>
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <g key={t}>
              <line x1={left} x2={left + pw} y1={Y(max * t)} y2={Y(max * t)} className="grid" />
              <text x={left - 6} y={Y(max * t) + 4} className="tick" textAnchor="end">{fmt(Math.round(max * t))}</text>
            </g>
          ))}
          {markIndex >= 0 && (
            <g>
              <line x1={X(markIndex)} x2={X(markIndex)} y1={top - 8} y2={top + ph} className="mark-line" />
              <text x={X(markIndex)} y={top - 10} className="tick strong" textAnchor="middle">{markLabel}</text>
            </g>
          )}
          {points.map((p, i) => {
            /* every nth label, plus the last — unless the last would collide with the one before it */
            const step = Math.ceil(points.length / 8), last = points.length - 1;
            return (i === last || (i % step === 0 && last - i >= step)) && (
            <text key={i} x={X(i)} y={height - 8} className="tick" textAnchor="middle">{p.short}</text>
          );
          })}
          {series.map((s, k) => {
            const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.values[k])}`).join('');
            const last = points.length - 1;
            return (
              <g key={s.label}>
                {k === 0 && <path d={`${d}L${X(last)},${Y(0)}L${X(0)},${Y(0)}Z`} fill={s.color} opacity={0.1} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
                <circle cx={X(last)} cy={Y(points[last].values[k])} r={4} fill={s.color} className="ring" />
                <text x={X(last) + 8} y={Y(points[last].values[k]) + 4} className="label">{fmt(points[last].values[k])}</text>
              </g>
            );
          })}
          {hover >= 0 && (
            <g>
              <line x1={X(hover)} x2={X(hover)} y1={top} y2={top + ph} className="crosshair" />
              {series.map((s, k) => <circle key={k} cx={X(hover)} cy={Y(points[hover].values[k])} r={4.5} fill={s.color} className="ring" />)}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/* ── donut: part-to-whole, at most 6 parts ── */
export function Donut({ data, centerLabel = 'Total', unit = '' }) {
  const { show, hide } = useTip();
  const total = data.reduce((n, d) => n + d.value, 0);
  const size = 180, r = 74, inner = 50;
  let a = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const sweep = total ? (d.value / total) * Math.PI * 2 : 0;
    const gap = data.filter(x => x.value > 0).length > 1 ? 0.025 : 0;     // the 2px surface gap
    const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
    a += sweep;
    if (d.value <= 0 || a1 <= a0) return null;
    const tip = e => show(e, <Tip title={d.label} lines={[['Value', `${fmt(d.value)}${unit}`], ['Share', `${total ? Math.round((d.value / total) * 100) : 0}%`]]} />);
    /* one part is the whole: an arc from a point back to itself draws nothing,
       so the full ring is drawn as a thick circle instead */
    if (sweep >= Math.PI * 2 - 1e-6) {
      return <circle key={d.label} cx={size / 2} cy={size / 2} r={(r + inner) / 2} fill="none" stroke={d.color || SERIES[i]} strokeWidth={r - inner} className="hit" onMouseMove={tip} onMouseLeave={hide} />;
    }
    const p = (ang, rad) => [size / 2 + rad * Math.cos(ang), size / 2 + rad * Math.sin(ang)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r), [x2, y2] = p(a1, inner), [x3, y3] = p(a0, inner);
    const path = `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${inner},${inner} 0 ${large} 0 ${x3},${y3}Z`;
    return (
      <path key={d.label} d={path} fill={d.color || SERIES[i]} className="hit"
        onMouseMove={e => show(e, <Tip title={d.label} lines={[['Value', `${fmt(d.value)}${unit}`], ['Share', `${total ? Math.round((d.value / total) * 100) : 0}%`]]} />)}
        onMouseLeave={hide} />
    );
  });
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={data.map(d => `${d.label} ${d.value}${unit}`).join(', ')}>
        {total ? arcs : <circle cx={size / 2} cy={size / 2} r={(r + inner) / 2} fill="none" stroke="var(--line)" strokeWidth={r - inner} />}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" className="donut-total">{fmt(total)}</text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="tick">{centerLabel}</text>
      </svg>
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <span className="swatch" style={{ '--c': d.color || SERIES[i] }} />
            <span className="dl-label">{d.label}</span>
            <span className="dl-value">{fmt(d.value)}{unit}</span>
            <span className="dl-pct">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── heatmap: rows × columns of counts, one cobalt hue light→dark ── */
export function Heatmap({ rows, cols, cells, max, skipCol = -1, unit = 'classes' }) {
  const { show, hide } = useTip();
  return (
    <div className="heatmap" style={{ '--cols': cols.length }} role="table" aria-label="Classes running by day and period">
      <div role="row" className="hm-row hm-head">
        <span role="columnheader" />
        {cols.map((c, j) => <span role="columnheader" key={j} className="hm-col">{j + 1}<small>{c.split(/[–-]/)[0]}</small></span>)}
      </div>
      {rows.map((r, i) => (
        <div role="row" className="hm-row" key={r}>
          <span role="rowheader" className="hm-day">{r.slice(0, 3)}</span>
          {cols.map((c, j) => {
            const v = cells[i]?.[j] || 0;
            const t = max ? v / max : 0;
            const lunch = j === skipCol && !v;
            return (
              <span role="cell" key={j}
                className={`hm-cell ${lunch ? 'lunch' : ''} ${v ? '' : 'zero'} ${t > 0.5 ? 'strong' : ''}`}
                style={{ '--t': `${Math.round(12 + t * 88)}%` }}
                aria-label={`${r} ${c}: ${lunch ? 'lunch' : `${v} ${unit}`}`}
                onMouseMove={e => show(e, <Tip title={`${r} · ${c}`} lines={[[lunch ? 'Lunch break' : 'Running', lunch ? '' : `${v} ${unit}`]]} />)}
                onMouseLeave={hide}>
                {v || ''}
              </span>
            );
          })}
        </div>
      ))}
      <div className="hm-scale" aria-hidden="true"><span>0</span><i /><span>{max} {unit}</span></div>
    </div>
  );
}

/* ── meter: a value against capacity on a lighter track of the same hue ── */
export function Meter({ value, max = 100, label }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="meter-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/* ── stat tile / hero figure ── */
export function Stat({ label, value, sub, hero = false, to }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className={hero ? 'stat-hero' : 'stat-value'}>{fmt(value)}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  );
  return <div className={`kpi ${hero ? 'hero-kpi' : ''}`}>{to ? <a href={to}>{body}</a> : body}</div>;
}
