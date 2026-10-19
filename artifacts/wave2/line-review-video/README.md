# Line - Wave 2 product walkthrough

Six chapters illustrate wallet connection and agent purchases, show actual Preprod receipts, and explain the privacy boundary. Wallet and transaction animations are labeled as illustrated; they do not certify a new organization deployment. The accepted operator checkpoint paid 25 and 20 valueless test units in 21 finalized transactions. The later 26-call repeat is a separate partial run.

The [final MP4](https://github.com/ShrikarT/line/releases/download/wave2-submission-2026-10-19/Line-Wave2-Product-Walkthrough.mp4) is **168.667 seconds**, **1920 x 1080**, H.264 at **60 fps** with AAC narration. It contains 10,120 frames and is 16,827,047 bytes. Full decoding passed; eight decoded frames were visually reviewed, including the corrected closing shot. The requested branch label is absent. Measured verification is in [qa/render-verification.json](qa/render-verification.json).

The authored duration is 168.658 seconds; export rounds to the next whole frame. The closing shot was rendered separately after removing the label and replaced at frame 8,426. The original narration bitstream is unchanged. Measured loudness is -22.0 LUFS with a -1.5 dBFS true peak. These are technical measurements, not a listening review.

With Node.js and FFmpeg/ffprobe installed:

```bash
node build-submission-film.mjs
npm run check
npx --yes hyperframes@0.8.171 preview --background
npm run render -- --output ../Line-Wave2-Product-Walkthrough.mp4 --fps 60 --quality delivery --no-best-effort
```

The CLI is pinned. The builder uses bundled voice files and measured durations, submits no Midnight transaction and needs no wallet credentials. Six sub-compositions have explicit motion assertions. The latest check passed without lint, runtime, layout or motion errors: 300 motion samples and all 74 contrast checks passed.

Narration uses local Kokoro am_michael. Speech alone is the audio identity; no music or paid voice service was used. Word captions were not generated. The current script and media provenance accompany the composition. Older drafts, recordings and QA are archived outside the repository.

Manrope's license is bundled in assets/OFL.txt. GSAP's notice is retained in assets/gsap.min.js. Registry text-stagger and agent-cursor informed the motion; the registry files and lock retain their source references.
