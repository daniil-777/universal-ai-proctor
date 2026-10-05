# Process Guide quick-start tour

The intro embeds a silent 20-second, four-scene tutorial. Its 960 × 600, 24 fps H.264 delivery is 181,957 bytes. Only the 31 KB JPEG poster downloads initially; the MP4 source is attached when Play is pressed. Native controls support seeking and full-screen playback. A written quick-start guide is available on the page.

The editable source is this HyperFrames 0.8.124 project. Runtime and font files are frozen under assets; the app itself has no HyperFrames or GSAP runtime dependency. The illustrated interface is an example, not an AI accuracy demonstration.

## Reproduce

Use Node 24 (22+ supported by the application).

```sh
HYPERFRAMES_NO_TELEMETRY=1 npm run check
HYPERFRAMES_NO_TELEMETRY=1 npm run dev
HYPERFRAMES_NO_TELEMETRY=1 npm run render -- --output renders/process-guide-tour.mp4 --fps 24 --quality delivery --crf 26
```

Repackage with ffmpeg copy and faststart into ../../frontend/public/media/process-guide-tour.mp4. Extract a JPEG at 2.9 seconds with ffmpeg's -frames:v 1 -q:v 7, then rebuild the frontend. Source fonts are Inter 400/500, downloaded from Google Fonts and distributed under the included SIL Open Font License. GSAP 3.14.2 retains its license header; it is used only in the editable video source.

The full check passed with zero errors/warnings and 64/64 sampled contrast checks. Midpoints, final decoded MP4 contact sheet, and animation map were reviewed. The short entrance/cursor motion is followed by deliberate reading holds. See ../../docs/screenshots/intro-tour-contact-sheet.jpg.
