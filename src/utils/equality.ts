export function isSubsetEqual<T extends Record<string, unknown>, V extends T>(
  obj1: T,
  obj2: V,
  subsetKeys: (keyof T)[]
) {
  return Object.entries(obj2)
    .filter(([key]) => subsetKeys.includes(key))
    .every(([key, value]) => obj1[key] === value);
}
