# PRD: SynthCheck — Private AI Image Detector for Chrome

## TL;DR

Build **SynthCheck**, an open-source Chrome extension that automatically estimates whether images on ordinary webpages are AI-generated and displays an AI-likelihood score beside every image it successfully analyzes. All image processing and inference must remain inside the browser, work offline after an optional one-time model download, and achieve at least 75.0% balanced accuracy on the bounty benchmark at the required 65% decision threshold.

## Background

- Most image-detection tools send viewed images to remote services, creating a privacy tradeoff and an ongoing network dependency.
- Modern browser capabilities make meaningful on-device inference possible without cloud or localhost services.
- The bounty is winner-take-all: the earliest valid submission that meets the accuracy, privacy, licensing, build, and reproducibility requirements wins.
- This is a greenfield product; no existing implementation or prior product behavior needs to be preserved.

## Problem & Target Users

- Everyday web users need a quick provenance signal while browsing without disclosing the images they view to a third party.
- Journalists, researchers, fact-checkers, and moderators need a lightweight screening aid for deciding which images warrant closer inspection.
- Existing detectors may be inaccurate, server-dependent, or disruptive to browsing; the challenge's reference detector scored below 60% balanced accuracy.
- The product is a probabilistic browsing aid, not proof that an image is authentic or AI-generated.

## Goals & Success Metrics

- Reach **at least 75.0% balanced accuracy** on the private evaluation benchmark when an AI-likelihood score of **65% or higher** is classified as AI-generated.
- Pass a clean-profile evaluation with internet access disabled after initial setup and localhost access blocked; image data and inference requests must generate **zero external network traffic**.
- Give every successfully analyzed eligible image a visible 0–100 AI-likelihood score, while clearly identifying skipped, unsupported, or failed analyses.
- Build successfully and reproducibly from the public repository using documented steps, with all source released under the MIT License.
- Preserve normal browsing usability through progressive analysis and without blocking page interaction; a measurable latency/resource budget will be set against the chosen reference hardware before release.

## Solution Overview

- A native Manifest V3 Chrome extension automatically discovers eligible images as pages load, change, and scroll.
- A browser-local detector evaluates each image using one or more permitted signals, such as learned visual features, metadata, watermark evidence, or a calibrated hybrid of these methods.
- Results appear as compact, non-obscuring labels attached to images, with a page-level summary available from the extension toolbar.
- A first-run experience acquires and verifies any optional public model weights once, then confirms that the extension is offline-ready.
- The extension uses cautious language and exposes failures instead of treating an inaccessible or unsupported image as real.

## User Experience

### 1. Install and become offline-ready

- The user installs the extension and sees a plain-language explanation of webpage access and the promise that images never leave the device.
- If weights are not bundled, setup shows download size, progress, verification, retry behavior, and a clear **Offline ready** confirmation.
- Automatic analysis does not begin until every inference-related asset required for offline use is present and verified.

### 2. Browse and interpret results

- Eligible images are queued automatically, prioritizing images in or near the viewport and responding to lazy loading, source changes, and dynamically added content.
- Each successfully analyzed image receives a label such as **AI likelihood: 82%**; scores at or above 65% are visually flagged as **Likely AI**.
- Labels progress through analyzing, result, and unavailable states without shifting page layout or covering important image content.
- Activating a label reveals a short explanation that the score is an estimate, not proof, plus the reason when analysis was unavailable.

### 3. Review and control the page

- The toolbar view shows setup/offline status and counts for analyzed, flagged, and unavailable images on the current page.
- Users can pause or resume analysis for the current site, hide or show in-page labels, and re-scan the page.
- Status is communicated with text and shape as well as color; controls support keyboard use, screen readers, zoom, and reduced motion.

## Requirements

### Detection and coverage

- Automatically discover and analyze eligible raster images rendered on ordinary webpages, including images added or changed after initial page load.
- Define and publish image eligibility rules; supported images must not be silently skipped because of origin, lazy loading, duplication, or responsive source selection.
- Reuse a prior result for duplicate image content when possible while displaying a result on every eligible rendered instance.
- Return an AI-likelihood score from 0 to 100 for every successful analysis and apply the required 65% threshold consistently in UI, tests, and benchmark reporting.
- Show a specific unavailable status for images that cannot be accessed, decoded, or evaluated; failures must never be represented as low AI likelihood.

### Privacy and offline behavior

- Perform image acquisition, preprocessing, inference, calibration, and result presentation entirely inside the Chrome extension/browser runtime.
- Never upload image pixels, image-derived features, page content, or browsing history, and never invoke cloud inference, external APIs, or localhost backends.
- Permit at most one initial download of public model weights; after setup, make no requests for models, weights, code, or other inference-related assets.
- Continue performing full detection after network access is removed, including after browser and extension restarts.

### Reliability and everyday usability

- Keep page interaction responsive by prioritizing visible content, bounding concurrent work, and safely handling pages with many images.
- Recover from interrupted setup, tab navigation, changed image sources, temporary resource pressure, and browser restarts without corrupt or misleading results.
- Provide explicit states when the browser, hardware, page type, permission state, or image source is unsupported.
- Avoid accusatory or definitive authenticity claims; present output as model-estimated AI likelihood.

### Submission and reproducibility

- Ship as a native Google Chrome Manifest V3 extension with no runtime dependency on Python, Node.js, Flask, or another local process.
- Publish all extension source under the MIT License and document model provenance and redistribution terms compatible with public use.
- Include complete, deterministic build, test, installation, initial-setup, and offline-verification instructions for a clean Chrome profile.
- Pin build inputs and publish integrity information for downloaded inference assets so maintainers can reproduce and verify the evaluated artifact.
- Do not use benchmark hashes, lookup tables, remote code, post-setup inference downloads, or behavior intended to circumvent evaluation.

## Acceptance Criteria

- On a clean Chrome profile, a maintainer can build from source, install the extension, complete the documented one-time setup, disable internet and localhost access, restart Chrome, and still analyze supported webpage images.
- Each successfully analyzed image displays its AI-likelihood score; a score of 65% or greater produces the required AI-generated classification, and unavailable images show a reason rather than a score.
- Network inspection after offline-ready status shows no outbound request containing image data and no request for inference code, models, weights, or related assets.
- Independent benchmark evaluation reports at least 75.0% balanced accuracy, giving equal weight to correct real-image and AI-image classifications.
- The public repository contains the MIT License and all instructions and assets needed to reproduce the submitted build within the challenge rules.

## Out of Scope

- Cloud inference, telemetry containing browsing/image data, accounts, synchronization, hosted dashboards, or any local backend service.
- Detection of AI-generated video, audio, or text; continuous analysis of animated frames; and broad content-moderation workflows.
- Support for non-Chromium browsers or mobile browsers in the first submission.
- Claims of forensic certainty, identification of a specific generator unless independently validated, or explanations that reveal training data provenance not supported by evidence.
- In-extension model training, user-supplied models, or additional model downloads after initial setup.

## Open Questions

- Which displayed content is eligible in v1: standard raster image elements only, or also CSS backgrounds, SVG, canvas, video posters, animated formats, frames, and authenticated/protected sources?
- What minimum image dimensions and supported formats preserve benchmark coverage without wasting resources on icons, sprites, and decorative assets?
- What model size, first-run download time, per-image latency, memory, battery, and fallback-performance budgets are acceptable on the reference evaluation hardware?
- Should scores below 65% be labeled **Likely real**, or should the UI use an uncertainty band while retaining 65% as the benchmark decision threshold?
- Is a non-WebGPU fallback required for the first submission, and what minimum Chrome version and hardware support policy should be published?

## Assumptions (Quick Mode)

| Assumption | Confidence |
| --- | --- |
| The displayed score means estimated probability that the image is AI-generated, not confidence in whichever class was selected. | High |
| Desktop Google Chrome is the only required v1 browser, and a Chrome Web Store release is not required for bounty evaluation. | High |
| An image may be explicitly marked unavailable when browser security or format limitations prevent analysis; it must not receive a fabricated score. | High |
| A compact in-page label plus toolbar summary is sufficient for the first submission; a persistent side panel is optional. | Medium |
| The initial model download may occur during onboarding, but all inference code and any other inference assets must already be packaged or acquired during that same setup. | Medium |
| Exact eligibility and performance budgets should be finalized after early model and browser-runtime validation rather than guessed in this PRD. | High |
