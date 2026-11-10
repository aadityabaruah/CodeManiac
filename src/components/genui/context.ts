import { createContext, useContext } from "react";

// Keep this tiny context separate from the optional renderer and parser.
export const InsideGenUi = createContext(false);

export function useInsideGenUi(): boolean {
  return useContext(InsideGenUi);
}
