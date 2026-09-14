export const CIRCUITS = [
  {
    name: "openLine",
    caller: "Issuer",
    proves: "Authorized issuer, L > 0, B = 0, no live line, C0 = H(I,L,0,e0,s).",
    discloses: "I, C0, status=open",
    hides: "L, salt, agent secret",
  },
  {
    name: "postQuote",
    caller: "Merchant",
    proves: "Registered merchant, A > 0, future expiry, Q unique.",
    discloses: "Q, public expiry, used=false",
    hides: "Merchant identity, amount, invoice id",
  },
  {
    name: "draw",
    caller: "Agent",
    proves: "Owns I, opens current C, Q live, B+A ≤ L, N unused. Writes C'.",
    discloses: "C', N, Q used",
    hides: "A, B, L, utilization",
  },
  {
    name: "acknowledgeRepayment",
    caller: "Issuer",
    proves: "Issuer receipt bound to current C, 0 < R ≤ B, N_repay unused.",
    discloses: "C', repay nullifier",
    hides: "R, B",
  },
  {
    name: "setStatus",
    caller: "Issuer",
    proves: "Issuer only. Draws require status=open.",
    discloses: "open | defaulted | closed",
    hides: "Books. Default does not publish B.",
  },
] as const;
