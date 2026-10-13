# Run the Line purchasing demo

Current local app: **http://127.0.0.1:5174/**.

From the audit checkout (`C:/Users/Shrikar/line-audit-review`), start it with:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

1. Select **Try API checkout**.
2. Keep **Complete both purchases** selected, then open the evaluation line.
3. Run the agent purchase plan. Both merchants deliver; the issuer's private view shows debt **45** and remaining capacity **15**.
4. In a fresh demo, choose **Decline and recovery**. Merchant A delivers, Merchant B declines with `Clearance could not be proven.` Acknowledge 25 units as the issuer, then retry the declined purchase. The earlier delivered service is retained.

The service results, generated Compact transitions and demo ledger projection are on the checkout page. The separate protocol consoles inspect their own configured runtime. Keep the checkout page open to retain its capabilities and exact retry IDs.

This is a local demonstration using demo units and deterministic services. It submits no proof or network transaction and transfers no assets. `npm run preview` also serves the checkout API after a build; static-file-only hosting does not.
