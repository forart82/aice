export function formatMetric(name, value) {
  return `${name}=${value.toFixed(2)}`;
}

export function sumList(items) {
  return items.reduce((acc, item) => acc + item, 0);
}
