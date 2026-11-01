"use client";

import { useCallback, useRef, useState } from "react";

export function useToast() {
  const [state, setState] = useState<{ msg: string; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string) => {
    setState((s) => ({ msg, n: (s?.n ?? 0) + 1 }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 2400);
  }, []);
  return { state, show };
}

export function Toast({ state }: { state: { msg: string } | null }) {
  return (
    <div className="toast" role="status" hidden={!state}>
      {state?.msg}
    </div>
  );
}
