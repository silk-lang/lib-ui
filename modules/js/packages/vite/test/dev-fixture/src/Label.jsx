import { useEffect, useState } from "react";

export function Label() {
  const [n, setN] = useState(0);
  useEffect(() => setN(1), []);
  return <box>{"n=" + n + " A"}</box>;
}
