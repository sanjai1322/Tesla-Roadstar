# Roadster

A scroll-driven Roadster experience built from real-time 3D, film and studio photography.

## Run it

```bash
cd site
npm install
npm run dev
```

Build for production with `npm run build` (output in `site/dist`).

## Stack

Vite, Three.js, GSAP ScrollTrigger and Lenis. Type is Geist and Geist Mono.

## What's where

| Path | Contents |
| --- | --- |
| `site/index.html` | Page structure, all sections |
| `site/src/stage.js` | Single WebGL renderer with three scenes: hero (animated GLB), structure x-ray (rigged GLB), inspect (studio GLB with the Blender cameras) |
| `site/src/thrust.js` | Cold gas thruster vapor: twin jets that hit the floor and roll out as ground billows |
| `site/src/main.js` | Scroll choreography, film, aero modes, studio flipbook, ending |
| `site/src/style.css` | Design tokens and layout |
| `site/public/models` | Draco-compressed GLBs exported from the three `.blend` files |
| `site/public/video` | 1080p web encodes of the source films |
| `site/public/img` | WebP gallery and section imagery |
| `*.blend`, `*.mp4`, `*.zip` | Raw sources (Git LFS) |

## Asset pipeline

1. Each `.blend` is exported to GLB from Blender 5.1 (modifiers applied, studio floor, FX and lights removed; the animated file exports its baked rig animation, the studio file keeps its 12 cameras).
2. GLBs are compressed with `gltf-transform optimize --compress draco --palette false`.
3. Films are re-encoded to 1080p H.264 (`_transcode.sh`). The aero film is cropped above its burned-in captions.
4. Images are converted to WebP at 2400 px plus a 1000 px variant.

Fan-built concept. Not affiliated with Tesla, Inc.
