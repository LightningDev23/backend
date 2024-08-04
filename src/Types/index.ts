export type PreventInfiniteRecursion<T> = T extends object ? { [K in keyof T]: PreventInfiniteRecursion<T[K]> } : T;
