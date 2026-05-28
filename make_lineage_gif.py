"""
make_lineage_gif.py  —  Russell Lab
====================================
Generates an animated GIF of a simulated lineage-tracing phylogeny.
The tree grows from root (left) to tips (right). Clades are coloured
by the time of their exposure; unexposed lineages are shown in grey.

Run from the lab-website directory:
    python3 make_lineage_gif.py

Dependencies:
    pip install numpy matplotlib Pillow
"""

import random
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.animation as animation

# ── Parameters — edit these freely ───────────────────────────────────────────

N_TIPS          = 20        # number of leaf cells
SEED            = 7         # change for a different tree shape
N_EXPOSURES     = 4         # number of distinct exposure events
N_FRAMES        = 150       # frames of growth animation
HOLD_FRAMES     = 35        # frames to hold the completed tree before loop
FPS             = 18        # frames per second
DPI             = 130
FIG_SIZE        = (6, 6)
OUTPUT_PATH     = 'assets/images/lineage_tracing.gif'

# Exposure colours — taken from the lab site palette
EXPOSURE_COLORS = ['#DC2626',   # red
                   '#D97706',   # amber
                   '#0D9488',   # teal
                   '#7C3AED']   # purple

UNEXPOSED_COLOR = '#AAAAAA'     # grey for unexposed lineages
BG_COLOR        = '#FFFFFF'     # white background
LINE_WIDTH      = 2.2
V_DUR           = 0.06          # fraction of animation time each vertical connector takes to grow
CORNER_RX       = 0.012         # corner radius in x-data-units (tune to taste)
CORNER_RY       = 0.40          # corner radius in y-data-units (tune to taste)

# ─────────────────────────────────────────────────────────────────────────────


# ── 1. Tree simulation ────────────────────────────────────────────────────────

def simulate_tree(n_tips, seed):
    """
    Build a random coalescent binary tree.
    All tips sit at time=1.0; the root is forced to time=0.0.
    Returns (nodes, root_idx).

    Each node is a dict:
        idx, left, right, parent   — tree structure
        time                        — position on x-axis (0=root, 1=tips)
        y                           — vertical drawing position
        is_tip, color
    """
    random.seed(seed)
    np.random.seed(seed)

    nodes = []

    # Leaf nodes at time = 1.0, y-positions 0..n_tips-1
    for i in range(n_tips):
        nodes.append(dict(
            idx=i, left=None, right=None, parent=None,
            time=1.0, is_tip=True, y=float(i), color=UNEXPOSED_COLOR
        ))

    # Draw n_tips-1 coalescent times uniformly in (0.08, 0.92)
    # Sorted descending so earlier merges are closer to the present
    coal_times = np.sort(np.random.uniform(0.08, 0.92, n_tips - 1))[::-1]

    active = list(range(n_tips))

    for t in coal_times:
        # Pick two random active lineages to merge
        a_pos, b_pos = random.sample(range(len(active)), 2)
        a, b = active[a_pos], active[b_pos]

        new_idx = len(nodes)
        nodes.append(dict(
            idx=new_idx, left=a, right=b, parent=None,
            time=float(t), is_tip=False, y=None, color=UNEXPOSED_COLOR
        ))
        nodes[a]['parent'] = new_idx
        nodes[b]['parent'] = new_idx

        active = [x for x in active if x not in (a, b)]
        active.append(new_idx)

    root_idx = active[0]
    nodes[root_idx]['time'] = 0.0
    return nodes, root_idx


def assign_y_positions(nodes, root_idx):
    """Post-order traversal: internal node y = midpoint of children's y."""
    def _post(i):
        n = nodes[i]
        if n['is_tip']:
            return n['y']
        ly = _post(n['left'])
        ry = _post(n['right'])
        n['y'] = (ly + ry) / 2.0
        return n['y']
    _post(root_idx)


def bfs_order(nodes, root_idx):
    """Return all node indices in breadth-first order."""
    result, queue = [], [root_idx]
    while queue:
        i = queue.pop(0)
        result.append(i)
        n = nodes[i]
        if not n['is_tip']:
            queue += [n['left'], n['right']]
    return result


# ── 2. Exposure assignment ────────────────────────────────────────────────────

def color_subtree(nodes, idx, color):
    """Recursively color a node and all its descendants."""
    nodes[idx]['color'] = color
    n = nodes[idx]
    if not n['is_tip']:
        color_subtree(nodes, n['left'], color)
        color_subtree(nodes, n['right'], color)


def assign_exposures(nodes, root_idx, n_exposures):
    """
    Pick n_exposures internal nodes spread across different time bands.
    Each one represents an exposure event affecting a different-sized clade.
    Ancestor–descendant pairs are avoided so exposures don't nest.

    Returns a sorted list of (time, color) tuples for reference.
    """
    order     = bfs_order(nodes, root_idx)
    internals = [i for i in order if not nodes[i]['is_tip'] and i != root_idx]

    # Sort by coalescent time so we can slice into time bands
    internals.sort(key=lambda i: nodes[i]['time'])

    excluded = set()
    chosen   = []

    # Pick one node from each evenly-spaced time band
    band_centres = np.linspace(0, len(internals) - 1, n_exposures + 2,
                               dtype=int)[1:-1]

    for centre in band_centres:
        # Look in a small window around this band centre
        window = range(max(0, centre - 4), min(len(internals), centre + 5))
        candidates = [internals[j] for j in window
                      if internals[j] not in excluded]
        if not candidates:
            continue

        pick = candidates[len(candidates) // 2]   # take the middle candidate
        chosen.append(pick)

        # Exclude all ancestors so we don't create nested exposures
        ancestor = pick
        while ancestor is not None:
            excluded.add(ancestor)
            ancestor = nodes[ancestor]['parent']

    # Apply colors
    exposure_events = []
    for color, node_idx in zip(EXPOSURE_COLORS, chosen):
        color_subtree(nodes, node_idx, color)
        exposure_events.append((nodes[node_idx]['time'], color))

    return sorted(exposure_events)


# ── 3. Build the tree ─────────────────────────────────────────────────────────

nodes, root_idx = simulate_tree(N_TIPS, SEED)
assign_y_positions(nodes, root_idx)
assign_exposures(nodes, root_idx, N_EXPOSURES)
draw_order = bfs_order(nodes, root_idx)


# ── 4. Pre-compute per-segment animation times ────────────────────────────────

def compute_anim_times(nodes, root_idx, v_dur):
    """
    BFS to compute the exact animation time each segment should START drawing,
    so that horizontal branches always meet the vertical that feeds into them.

    h_start[i]  — when node i's horizontal branch begins
    h_arrive[i] — when node i's horizontal branch finishes (reaches n.time)
    v_start[i]  — when node i's vertical connector begins  (= h_arrive[i])
    v_end[i]    — when node i's vertical connector finishes (= v_start + v_dur)

    Root special case: it has no incoming horizontal, so its vertical
    starts immediately at t = 0.
    """
    h_start  = {}
    h_arrive = {}
    v_start  = {}
    v_end    = {}

    # Root: vertical starts at once
    v_start[root_idx]  = 0.0
    v_end[root_idx]    = v_dur

    queue = [root_idx]
    while queue:
        i = queue.pop(0)
        n = nodes[i]
        if n['is_tip']:
            continue

        # Children's horizontals start when THIS vertical finishes
        for child_idx in [n['left'], n['right']]:
            c = nodes[child_idx]
            h_s = v_end[i]                              # wait for parent vertical
            h_a = h_s + (c['time'] - n['time'])         # arrives after branch length
            h_start[child_idx]  = h_s
            h_arrive[child_idx] = h_a

            if not c['is_tip']:
                # Internal child's vertical starts when its horizontal arrives
                v_start[child_idx] = h_a
                v_end[child_idx]   = h_a + v_dur
                queue.append(child_idx)

    return h_start, h_arrive, v_start, v_end


h_start_t, h_arrive_t, v_start_t, v_end_t = compute_anim_times(
    nodes, root_idx, V_DUR
)

# T_END: latest time any segment finishes drawing
tip_ends = [h_arrive_t[i] for i in h_arrive_t if nodes[i]['is_tip']]
T_END    = max(tip_ends) if tip_ends else 1.0 + V_DUR


# ── 4. Drawing ────────────────────────────────────────────────────────────────

def quad_bezier(A, B, C, n=20):
    """
    Return n points on the quadratic Bézier from A to C with control point B.
    Used to draw rounded corners: A = end of vertical, B = sharp corner,
    C = start of horizontal.
    """
    t = np.linspace(0, 1, n)
    x = (1 - t)**2 * A[0] + 2*t*(1 - t)*B[0] + t**2 * C[0]
    y = (1 - t)**2 * A[1] + 2*t*(1 - t)*B[1] + t**2 * C[1]
    return x, y


def draw_frame(ax, t):
    """
    Render the tree at animation time t using the pre-computed segment times.

    Each horizontal branch starts exactly when its parent's vertical finishes,
    and each vertical starts exactly when its incoming horizontal arrives —
    so no segment ever appears before the one feeding into it.
    """
    ax.clear()
    ax.set_facecolor(BG_COLOR)
    ax.set_xlim(-0.05, 1.08)
    ax.set_ylim(-1.5, N_TIPS + 0.5)
    ax.axis('off')

    for i in draw_order:
        n = nodes[i]

        # ── Horizontal branch ───────────────────────────────────────────────
        if i in h_start_t:
            p      = nodes[n['parent']]
            h_s    = h_start_t[i]
            h_a    = h_arrive_t[i]
            # Clamp rx so it never exceeds 40% of the branch length
            branch_len = n['time'] - p['time']
            rx     = min(CORNER_RX, branch_len * 0.4)
            if t >= h_s:
                progress = min(1.0, (t - h_s) / (h_a - h_s))
                x_start  = p['time'] + rx
                x_end    = x_start + progress * (n['time'] - x_start)
                if x_end > x_start:
                    ax.plot([x_start, x_end], [n['y'], n['y']],
                            color=n['color'], linewidth=LINE_WIDTH,
                            solid_capstyle='round', zorder=2)

        # ── Vertical connector — grows from midpoint outward ────────────────
        if i in v_start_t:
            v_s = v_start_t[i]
            if t >= v_s:
                v_prog = min(1.0, (t - v_s) / V_DUR)
                lc     = nodes[n['left']]
                rc     = nodes[n['right']]
                upper  = lc if lc['y'] > rc['y'] else rc
                lower  = rc if upper is lc else lc

                # Clamp ry so it never exceeds 40% of each half-connector length
                half_u = upper['y'] - n['y']
                half_l = n['y']    - lower['y']
                ry_u   = min(CORNER_RY, half_u * 0.4)
                ry_l   = min(CORNER_RY, half_l * 0.4)
                # Also use the matching rx for these children
                rx_u   = min(CORNER_RX, (upper['time'] - n['time']) * 0.4)
                rx_l   = min(CORNER_RX, (lower['time'] - n['time']) * 0.4)

                y_upper = n['y'] + v_prog * (upper['y'] - ry_u - n['y'])
                y_lower = n['y'] - v_prog * (n['y'] - lower['y'] - ry_l)

                ax.plot([n['time'], n['time']], [n['y'], y_upper],
                        color=upper['color'], linewidth=LINE_WIDTH,
                        solid_capstyle='round', zorder=2)
                ax.plot([n['time'], n['time']], [n['y'], y_lower],
                        color=lower['color'], linewidth=LINE_WIDTH,
                        solid_capstyle='round', zorder=2)

                # ── Bézier corner arcs (appear once vertical is complete) ───
                if v_prog >= 1.0:
                    bx, by = quad_bezier(
                        (n['time'],          upper['y'] - ry_u),
                        (n['time'],          upper['y']),
                        (n['time'] + rx_u,   upper['y']),
                    )
                    ax.plot(bx, by, color=upper['color'], linewidth=LINE_WIDTH,
                            solid_capstyle='round', zorder=2)

                    bx, by = quad_bezier(
                        (n['time'],          lower['y'] + ry_l),
                        (n['time'],          lower['y']),
                        (n['time'] + rx_l,   lower['y']),
                    )
                    ax.plot(bx, by, color=lower['color'], linewidth=LINE_WIDTH,
                            solid_capstyle='round', zorder=2)


# ── 5. Animation ──────────────────────────────────────────────────────────────

fig, ax = plt.subplots(figsize=FIG_SIZE, facecolor=BG_COLOR)
fig.subplots_adjust(left=0.01, right=0.97, top=0.97, bottom=0.03)

# Growth phase: ease-in-out from 0 → T_END (computed from tree structure)
raw_times  = np.linspace(0.0, 1.0, N_FRAMES)
ease_times = T_END * (1 - np.cos(raw_times * np.pi)) / 2   # S-curve 0 → T_END

# Hold phase: freeze on completed tree before looping
hold_times = np.full(HOLD_FRAMES, T_END)
all_times  = np.concatenate([ease_times, hold_times])
total_frames = len(all_times)


def animate(frame):
    draw_frame(ax, all_times[frame])
    return []


ani = animation.FuncAnimation(
    fig, animate,
    frames=total_frames,
    interval=1000 / FPS,
    blit=False
)

print(f'Rendering {total_frames} frames → {OUTPUT_PATH}')
ani.save(OUTPUT_PATH, writer='pillow', fps=FPS, dpi=DPI,
         savefig_kwargs={'facecolor': BG_COLOR})
plt.close()
print('Done.')
