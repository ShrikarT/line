# Line narrated evidence review

Eight scenes explain the enterprise API/compute purchasing hypothesis, private-credit architecture, verified recovery work and remaining release gates. This is an evidence presentation with local synthetic narration, rather than recorded live application operation.

The user approved the concrete Studio preview for local MP4 rendering. Publication and hackathon submission are separate actions. The composition lasts **204.674 seconds** at **1920 × 1080**, with a requested render rate of **30 fps**.

From this directory:

```powershell
npm run dev
npm run check
npm run render -- --output ../line-review.mp4 --fps 30 --workers 1 --quality delivery
```

The CLI is pinned to HyperFrames 0.8.152. Single-worker rendering streams frames; the initial two-worker attempt stopped before capture because its estimated 12.7 GB temporary-frame requirement exceeded available disk space. The MP4 remains a local ignored artifact.

`transcript.md` is the narration script. Voice assets are locally generated Kokoro `am_michael` PCM audio. No music or paid voice provider was used. Word-level transcription/caption timings were not generated. The eight clips each provide a short opening/closing hold around their measured narration duration.

`qa/composition-check.json` preserves a passing composition check: zero runtime, layout and motion errors, and all 54 contrast checks pass AA. Nine structural lint warnings recommend splitting the single HTML's eight scenes into sub-compositions; they remain documented. `qa/animation-map.json` records the motion review, and `qa/scene-midpoints.jpg` is the inspected pre-render contact sheet. `qa/render-verification.json` records the finished MP4: **204.7 seconds, H.264 1080p/30 fps, AAC stereo, 9,863,848 bytes**. Full-file decoding passes. Audio mean/max are −25.4/−1.5 dBFS after the renderer applied 0.9 dB peak attenuation; these signal checks do not substitute for a listening review. All eight MP4 midpoint images were visually inspected; `qa/rendered-midpoints.jpg` preserves the contact sheet.

The native lifecycle evidence covers 30 calls across all 12 circuits, 100 deliberate exits, 82 controls and four interruption/corruption checks. Its ledger, time and receipt records are synthetic; fee balancing is disabled. Reported canonical Preprod deployment, network finality, authentic asset movement, full-history privacy, independent institutional custody and customer adoption are separate evidence gates. The two earlier seven-call native failures remain preserved in the linked audit.

Font licensing is in `../OFL.txt`; GSAP's license notice is retained in `assets/gsap.min.js`.
