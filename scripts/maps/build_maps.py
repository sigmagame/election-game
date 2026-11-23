"""Builds compact SVG-path map data from GeoJSON (topology-aware simplification, pure Python)."""
import json, math, re, sys, collections, os

def norm(s):
    s = re.sub(r'\(.*?\)', '', s.lower()).replace('&', 'and')
    return re.sub(r'[^a-z0-9]', '', s)

def dp(pts, eps):
    """Douglas-Peucker on an open polyline (iterative)."""
    n = len(pts)
    if n < 3: return pts
    keep = [False] * n; keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L2 == 0: d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best: best, bi = d, i
        if best > eps:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def rings_of(geom):
    out = []
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        for r in poly:
            pts = [(round(x, 5), round(y, 5)) for x, y in r]
            if pts[0] == pts[-1]: pts = pts[:-1]
            if len(pts) >= 3: out.append(pts)
    return out

def area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2

def simplify_shared(feats, eps, min_area):
    """feats: {id: [rings]} -> {id: [simplified rings]}; shared borders simplify identically."""
    allr = [(fid, r) for fid, rs in feats.items() for r in rs]
    edge_owners = collections.defaultdict(set)
    for ri, (_, r) in enumerate(allr):
        n = len(r)
        for i in range(n):
            a, b = r[i], r[(i + 1) % n]
            edge_owners[(a, b) if a <= b else (b, a)].add(ri)
    cache = {}
    out = collections.defaultdict(list)
    for ri, (fid, r) in enumerate(allr):
        n = len(r)
        own = []
        for i in range(n):
            a, b = r[i], r[(i + 1) % n]
            own.append(frozenset(edge_owners[(a, b) if a <= b else (b, a)]))
        nodes = [i for i in range(n) if own[i - 1] != own[i]]
        if not nodes: nodes = [0]
        arcs = []
        for k, s in enumerate(nodes):
            e = nodes[(k + 1) % len(nodes)]
            seq = [r[(s + j) % n] for j in range(((e - s) % n or n) + 1)]
            arcs.append(seq)
        ring = []
        for seq in arcs:
            key = tuple(seq) if seq <= seq[::-1] else tuple(seq[::-1])
            if key not in cache: cache[key] = dp(list(key), eps)
            s = cache[key]
            if tuple(seq) != key: s = s[::-1]
            ring += s[:-1]
        if len(ring) >= 3 and area(ring) >= min_area:
            out[fid].append(ring)
    return out

class Proj:
    def __init__(self, lon0, lat1, scale, kx):
        self.lon0, self.lat1, self.s, self.kx = lon0, lat1, scale, kx
    def __call__(self, p): return ((p[0] - self.lon0) * self.kx * self.s, (self.lat1 - p[1]) * self.s)

def to_path(rings, proj):
    segs = []
    for r in rings:
        q = [proj(p) for p in r]
        d = 'M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in q) + 'Z'
        segs.append(d)
    return ''.join(segs)

def bbox(rings):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)
