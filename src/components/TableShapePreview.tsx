import { TableShape } from '@/lib/types';

interface Props {
  shape?: TableShape;
  seats: number;
  status: 'free' | 'running' | 'pending-payment' | 'closed';
  size?: number; // px container
  label?: string;
}

/** Renders a top-down table with chairs around it. */
export default function TableShapePreview({ shape = 'square', seats, status, size = 110, label }: Props) {
  const colors: Record<string, { table: string; chair: string; border: string }> = {
    free:    { table: 'fill-status-free/15 stroke-status-free', chair: 'fill-status-free/40 stroke-status-free', border: '' },
    running: { table: 'fill-status-running/20 stroke-status-running', chair: 'fill-status-running/60 stroke-status-running', border: '' },
    'pending-payment': { table: 'fill-status-pending-payment/20 stroke-status-pending-payment', chair: 'fill-status-pending-payment/60 stroke-status-pending-payment', border: '' },
    closed:  { table: 'fill-status-closed/20 stroke-status-closed', chair: 'fill-status-closed/60 stroke-status-closed', border: '' },
  };
  const c = colors[status] || colors.free;
  const n = Math.max(1, Math.min(20, seats));
  const cx = size / 2;
  const cy = size / 2;
  const chairR = Math.max(5, size * 0.07);
  const chairOffset = size * 0.42; // distance from center to chair

  // Chair positions around perimeter
  const chairs: Array<{ x: number; y: number }> = [];
  if (shape === 'round') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      chairs.push({ x: cx + Math.cos(a) * chairOffset, y: cy + Math.sin(a) * chairOffset });
    }
  } else {
    // square/rectangle: distribute on 4 sides
    const sidesCount = [0, 0, 0, 0]; // top, right, bottom, left
    for (let i = 0; i < n; i++) sidesCount[i % 4]++;
    const isRect = shape === 'rectangle';
    const w = isRect ? size * 0.7 : size * 0.55;
    const h = isRect ? size * 0.4 : size * 0.55;
    const left = cx - w / 2, right = cx + w / 2, top = cy - h / 2, bottom = cy + h / 2;
    const pad = chairR + 4;
    // top
    for (let i = 0; i < sidesCount[0]; i++) {
      const t = (i + 1) / (sidesCount[0] + 1);
      chairs.push({ x: left + (right - left) * t, y: top - pad });
    }
    // right
    for (let i = 0; i < sidesCount[1]; i++) {
      const t = (i + 1) / (sidesCount[1] + 1);
      chairs.push({ x: right + pad, y: top + (bottom - top) * t });
    }
    // bottom
    for (let i = 0; i < sidesCount[2]; i++) {
      const t = (i + 1) / (sidesCount[2] + 1);
      chairs.push({ x: left + (right - left) * t, y: bottom + pad });
    }
    // left
    for (let i = 0; i < sidesCount[3]; i++) {
      const t = (i + 1) / (sidesCount[3] + 1);
      chairs.push({ x: left - pad, y: top + (bottom - top) * t });
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {shape === 'round' && (
        <circle cx={cx} cy={cy} r={size * 0.27} className={c.table} strokeWidth={2} />
      )}
      {shape === 'square' && (
        <rect x={cx - size * 0.28} y={cy - size * 0.28} width={size * 0.56} height={size * 0.56} rx={size * 0.06} className={c.table} strokeWidth={2} />
      )}
      {shape === 'rectangle' && (
        <rect x={cx - size * 0.35} y={cy - size * 0.2} width={size * 0.7} height={size * 0.4} rx={size * 0.05} className={c.table} strokeWidth={2} />
      )}
      {chairs.map((ch, i) => (
        <circle key={i} cx={ch.x} cy={ch.y} r={chairR} className={c.chair} strokeWidth={1.5} />
      ))}
      {label && (
        <text x={cx} y={cy + 4} textAnchor="middle" className="fill-foreground" style={{ fontSize: size * 0.13, fontWeight: 700 }}>
          {label}
        </text>
      )}
    </svg>
  );
}
