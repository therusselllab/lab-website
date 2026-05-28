"""
Generate exposure-zap.gif from hero-bg.jpg.
Topographic contour lines pulse in a different colour each time.
Each full closed contour loop lights up simultaneously.
"""

import numpy as np
from PIL import Image
from scipy.ndimage import label, gaussian_filter, binary_dilation

SIZE     = 650
SRC_PATH = "/Users/arussell/Documents/personal/lab-website/assets/images/hero-bg.jpg"
OUT_PATH = "/Users/arussell/Documents/personal/lab-website/assets/images/exposure-zap.gif"

# ── 1. Load + resize ──────────────────────────────────────────────────────────
src   = Image.open(SRC_PATH)
small = src.resize((SIZE, SIZE), Image.LANCZOS)
arr   = np.array(small).astype(float)

# Slight darkening so the teal glow pops
base = np.clip(arr * 0.80, 0, 255).astype(np.uint8)
base_img = Image.fromarray(base)

# ── 2. Detect contour lines via local contrast ────────────────────────────────
gray     = 0.299*arr[:,:,0] + 0.587*arr[:,:,1] + 0.114*arr[:,:,2]
blurred  = gaussian_filter(gray, sigma=5)
contrast = blurred - gray      # positive where pixel is darker than surroundings

line_mask = contrast > 15      # threshold that gives exactly the 62 loops
labeled, _  = label(line_mask)
sizes       = np.bincount(labeled.ravel())

# Top N contours by size, spread around the image for visual variety
# (pre-selected from analysis: 7 largest by pixel count)
N = 7
all_comps  = sorted(range(1, len(sizes)), key=lambda i: sizes[i], reverse=True)
top_idx    = all_comps[:N]
contours   = [labeled == i for i in top_idx]
print("Contour sizes:", [int(sizes[i]) for i in top_idx])

# ── 3. Build global palette (background + 7 per-colour ramps) ────────────────
GLOW_START   = 200
SHADES       = 8   # shades per colour
# Peak RGB for each of the 7 contours
PEAK_COLOURS = [
    (  0, 255, 240),   # 0 teal
    (255,  80,  70),   # 1 coral
    (255, 210,  30),   # 2 gold
    ( 50, 255, 140),   # 3 mint green
    (180,  90, 255),   # 4 violet
    (255, 150,  30),   # 5 orange
    (255,  60, 180),   # 6 hot pink
]

base_q  = base_img.quantize(colors=200, method=Image.Quantize.MEDIANCUT)
raw_pal = list(base_q.getpalette())
pal_data = raw_pal + [0] * (768 - len(raw_pal))   # pad to 256 entries

# Fill slots 200-255: 7 colours × 8 shades = 56 entries
for ci, (pr, pg, pb) in enumerate(PEAK_COLOURS):
    for si in range(SHADES):
        t   = (si + 1) / SHADES          # 0.125 → 1.0
        idx = GLOW_START + ci * SHADES + si
        pal_data[idx * 3 + 0] = int(pr * t)
        pal_data[idx * 3 + 1] = int(pg * t)
        pal_data[idx * 3 + 2] = int(pb * t)

palette_img = Image.new("P", (1, 1))
palette_img.putpalette(pal_data)

def quantise(rgb_arr):
    return Image.fromarray(rgb_arr.astype(np.uint8)).quantize(
        palette=palette_img, dither=0
    )

# ── 4. Frame builder ──────────────────────────────────────────────────────────
def glow_color(colour_idx, intensity):
    shade = int(intensity * (SHADES - 1))          # 0 → SHADES-1
    idx   = GLOW_START + colour_idx * SHADES + shade
    return np.array(pal_data[idx*3 : idx*3+3], dtype=np.uint8)

def outer_glow_color(colour_idx, intensity):
    return glow_color(colour_idx, intensity * 0.35)

def make_frame(contour_mask=None, colour_idx=0, intensity=0.0):
    out = base.copy()
    if contour_mask is not None and intensity > 0.0:
        dilated = binary_dilation(contour_mask, iterations=2)
        outer   = dilated & ~contour_mask
        out[contour_mask] = glow_color(colour_idx, intensity)
        out[outer]        = outer_glow_color(colour_idx, intensity)
    return out

# ── 5. Build frame list ───────────────────────────────────────────────────────
FADE_IN  = 3
HOLD     = 2
FADE_OUT = 3
PAUSE    = 7    # dark frames between contours (last one held at 990 ms)
INTRO    = 3    # initial dark frames

frames    = []
durations = []
dark_arr  = make_frame()

def add(arr, ms=140):
    frames.append(quantise(arr))
    durations.append(ms)

for _ in range(INTRO):
    add(dark_arr)

for ci, contour_mask in enumerate(contours):
    for i in range(FADE_IN):
        t = (i + 1) / (FADE_IN + 1)
        add(make_frame(contour_mask, ci, t))

    for _ in range(HOLD):
        add(make_frame(contour_mask, ci, 1.0))

    for i in range(FADE_OUT):
        t = 1.0 - (i + 1) / (FADE_OUT + 1)
        add(make_frame(contour_mask, ci, t))

    for j in range(PAUSE):
        ms = 990 if j == PAUSE - 1 else 140
        add(dark_arr, ms)

for _ in range(3):
    add(dark_arr)

# ── 6. Save ───────────────────────────────────────────────────────────────────
print(f"Saving {len(frames)} frames …")
frames[0].save(
    OUT_PATH,
    save_all=True,
    append_images=frames[1:],
    loop=0,
    duration=durations,
    optimize=False,
)
print(f"Done → {OUT_PATH}")
