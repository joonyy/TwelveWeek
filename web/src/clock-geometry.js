export const clockPoint = (radius, minutes) => {
  const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
  return [200 + radius * Math.cos(angle), 200 + radius * Math.sin(angle)];
};

export function clockArc(start, end, inner, outer) {
  const finish = Math.min(end, start + 1439.99);
  const a = clockPoint(outer, start),
    b = clockPoint(outer, finish),
    c = clockPoint(inner, finish),
    d = clockPoint(inner, start);
  const large = finish - start > 720 ? 1 : 0;
  return `M ${a} A ${outer} ${outer} 0 ${large} 1 ${b} L ${c} A ${inner} ${inner} 0 ${large} 0 ${d} Z`;
}
