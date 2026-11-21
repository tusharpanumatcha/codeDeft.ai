/** "1 file", "3 files" — with thousands separators. */
export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
