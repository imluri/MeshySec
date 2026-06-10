<p align="center">
  <img src="logo.png" width="110" alt="Meshy GLB Exporter logo">
</p>

<h1 align="center">Meshy GLB Exporter</h1>

<p align="center">A Chrome extension that adds a blue <b>GLB</b> button to the Meshy model viewer so you can save your own models as a <code>.glb</code> 3D file.</p>

---

## What it does

When you open one of **your own** models on [meshy.ai](https://www.meshy.ai/workspace), this
extension puts a blue **🧊 GLB** button in the viewer toolbar. Click it, and it saves the model's
shape to a `.glb` file on your computer — a normal 3D file you can open in Blender and almost
anything else.

> It exports the **geometry** (the shape). Colors/textures come later. For **personal use of
> models you made on your own account.**

---

## 🛠️ Install it (super simple)

### ⚡ Easiest way — double-click `install.bat` (Windows)

1. Double-click **`install.bat`** in this folder.
2. It builds the extension (if needed) and opens **Chrome's extensions page** plus this folder for you. The path to the `dist` folder is even copied to your clipboard.
3. In Chrome: turn on **Developer mode** (top-right), click **Load unpacked**, and choose the **`dist`** folder (or paste the copied path).
4. Done! 🎉 *(First time only: if it asks for Node.js, click the link it opens, install it, then run `install.bat` again.)*

Prefer to do it by hand, or not on Windows? Use the steps below. 👇

---

### Step A — get the `dist` folder ready (one time)

If you downloaded this project as a ready-to-use folder that already has a **`dist`** folder
inside it, **skip to Step B.** 🎉

Otherwise, you need to "build" it once:

1. Install **Node.js** from <https://nodejs.org> (click the big green button, then Next → Next → Finish).
2. Open this project folder.
3. Open a terminal in that folder and type these two lines, pressing Enter after each:
   ```
   npm install
   npm run build
   ```
4. A new **`dist`** folder appears. That's the extension. ✅

### Step B — add it to Chrome

1. Open **Google Chrome**.
2. In the address bar at the top, type this and press Enter:
   ```
   chrome://extensions
   ```
3. Find the **“Developer mode”** switch in the **top-right corner** and turn it **ON**. 🔛
4. Click the **“Load unpacked”** button (top-left).
5. A file picker opens. Choose the **`dist`** folder from this project and click **Select Folder**.
6. Done! You should see **Meshy GLB Exporter** with the blue cube logo. 🧊

> Did you change or rebuild something? Go back to `chrome://extensions` and click the little
> **↻ reload** circle on the extension's card.

---

## ▶️ How to use it

1. Go to <https://www.meshy.ai/workspace> and **open one of your models** so you can see it spin in 3D.
2. Look at the **toolbar at the bottom** of the viewer.
3. Click the blue **🧊 GLB** button.
4. A `.glb` file downloads to your computer. That's your model! 🥳

Want to check it worked? Drag the `.glb` file onto <https://gltf-viewer.donmccurdy.com> and you'll see it.

---

## 🔄 Turn the `.glb` into other formats (OBJ, FBX, STL, USDZ…)

A `.glb` opens almost everywhere. To convert it:

- **Blender** (free): *File → Import → glTF 2.0*, then *File → Export →* whatever you want.
- Or any online glTF converter.

---

## ℹ️ Good to know

- ✅ Works on **your own** Meshy models, for **personal use**.
- 🔷 The button only appears **when a model is open** in the viewer (that's the only time export makes sense).
- 📐 Right now it exports **geometry only** (shape, no textures yet).
- 🧱 It grabs the model straight from the viewer in your browser — nothing is sent anywhere.

---

## 👩‍💻 For developers

```bash
npm install        # install build + test tools
npm run build      # bundle the extension into dist/
npm test           # run unit tests (Vitest)
npm run icons      # regenerate dist icons from logo.png
```

- **Geometry capture / scene discovery:** [`src/main/capture.js`](src/main/capture.js)
- **GLB writer:** [`src/main/glb.js`](src/main/glb.js)
- **Page bridge (MAIN world):** [`src/main/index.js`](src/main/index.js)
- **Toolbar button (UI):** [`src/ui/index.js`](src/ui/index.js)
- **Design / plan / investigation notes:** [`docs/`](docs/)
