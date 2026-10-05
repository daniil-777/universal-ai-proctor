# Preserved default surgical training video

`uncomplicated-cholecystectomy.mp4` is the unchanged H.264 video extracted from the original app's default `AI-Proctor/sample-data/Uncomplicated cholecystectomy (3).zip`, member `videos/c5505f15-83c3-4a44-b525-1dedf474d553.mp4`.

- 252.766667 seconds; 660 × 540; 30 fps; 37,894,412 bytes.
- SHA-256: `41eff5c46aec953cbabe7861213fb7d7c30a6f0c702066034623630b61a0e1fd`.
- Matching guidance: the preserved `guidance-library/Cholecystectomy.txt`.

Choose **Uncomplicated cholecystectomy — Original default** from **Choose a sample video** on the welcome page or in **Sources & setup**. Selecting it loads both the recording and its matching guidance. It does not enable the planned simulator integration or import simulator telemetry as visual evidence.

The recording is served only after selection through the existing session video stream with HTTP byte ranges. The server stages a disposable hard link per session (copy fallback across filesystems); removing a session does not delete this immutable sample. No browser upload or duplicate transfer of the recording is required.
