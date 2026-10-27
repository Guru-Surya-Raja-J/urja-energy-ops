import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip, fmt } from './common';

const axis = { fontSize: 11, fill: 'var(--muted)' };

/**
 * Single-series daily kWh columns. Incomplete days (e.g. the last day of a window)
 * use a lighter step of the same hue and say so in the tooltip.
 */
export function DailyChart({ days, average, height = 200 }) {
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={days} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => String(Number(d.slice(8)))}
            tick={axis}
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => fmt(v, 0)} />
          <Tooltip
            cursor={{ fill: 'var(--accent-wash)' }}
            content={<ChartTooltip unit="kWh" note={(p) => (p.complete ? null : 'Partial day — some intervals missing')} />}
          />
          {average ? (
            <ReferenceLine
              y={average}
              stroke="var(--text-2)"
              strokeWidth={1}
              label={{ value: `avg ${fmt(average)}`, position: 'insideTopRight', fill: 'var(--text-2)', fontSize: 11 }}
            />
          ) : null}
          <Bar dataKey="kwh" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {days.map((d) => (
              <Cell key={d.date} fill={d.complete ? 'var(--accent)' : 'var(--accent-soft)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
