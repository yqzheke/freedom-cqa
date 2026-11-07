import { hash, type State } from "./store";

// Content stays deduplicated, but choosing a previously imported manifest again
// must make it current. Documents, assessment history and calls are unchanged.
export function rememberImport(s: State, group: string, payload: unknown) {
  const digest = hash(payload);
  const previous = s.imports.find(i => i.hash === digest);
  s.imports = s.imports.filter(i => i.hash !== digest);
  s.imports.push(previous ?? { group, hash: digest, raw: payload });
}
