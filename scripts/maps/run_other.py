import json, sys, collections, difflib
sys.path.insert(0, '.')
from build_maps import *
D = '/mnt/user-data/attachments/d6785510-f880-53fa-a4cd-dc7679bc8c45/'
P = '/tmp/claude-0/-home-claude/d6785510-f880-53fa-a4cd-dc7679bc8c45/scratchpad/proj/election-game/'
os.makedirs(P + 'src/data/maps/assembly', exist_ok=True)

# ---- state-level map (game state codes)
sf = {}
for f in json.load(open(D + '363b82c4-india_states_campaign.geojson'))['features']:
    sf[f['properties']['STATE_ID']] = rings_of(f['geometry'])
ss = simplify_shared(sf, 0.02, 0.0000015)
proj = Proj(68.0, 37.2, 37.0, 0.92)
items = {}
for k in sorted(sf):
    rs = ss.get(k) or [dp(max(sf[k], key=area), 0.003)]
    x0, y0, x1, y1 = bbox([[proj(p) for p in r] for r in rs])
    items[k] = {'d': to_path(rs, proj), 'c': [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]}
s = json.dumps({'viewBox': [1000, 1130], 'items': items}, separators=(',', ':'))
open(P + 'src/data/maps/india-states.json', 'w').write(s); print('states', len(items), len(s) // 1024, 'KB')

# ---- one state's assembly map
def build_state(geo, state_name, slug):
    ac = [r for r in next(v for v in json.load(open(P + 'src/data/assembly-constituencies-2024.json')).values() if isinstance(v, list)) if r['state'] == state_name]
    pcs = collections.defaultdict(list)
    for r in ac: pcs[norm(r['parentParliamentaryConstituency'])].append(r)
    feats = {}; used = set()
    for f in json.load(open(geo))['features']:
        p = f['properties']; nm = re.sub(r'\((SC|ST)\)?', '', p['AC_NAME']).strip(); nm = re.sub(r'\(\s*SC$', '', nm).strip()
        pool = [r for r in pcs.get(norm(p['PC_NAME']), []) if r['id'] not in used]
        if not pool: pool = [r for r in ac if r['id'] not in used]
        best = max(pool, key=lambda r: difflib.SequenceMatcher(None, norm(nm), norm(r['name'])).ratio())
        used.add(best['id']); feats[best['id']] = rings_of(f['geometry'])
        sc = difflib.SequenceMatcher(None, norm(nm), norm(best['name'])).ratio()
        if sc < 0.8: print('  weak match', p['AC_NAME'], '->', best['name'], round(sc, 2))
    assert len(feats) == len(ac), (len(feats), len(ac))
    simp = simplify_shared(feats, 0.004, 0.00000005)
    allp = [p for rs in feats.values() for r in rs for p in r]
    lons = [p[0] for p in allp]; lats = [p[1] for p in allp]
    kx = math.cos(math.radians((min(lats) + max(lats)) / 2))
    w = (max(lons) - min(lons)) * kx; h = max(lats) - min(lats)
    scale = 1000 / max(w, h)
    pr = Proj(min(lons), max(lats), scale, kx)
    out = {}
    for fid in sorted(feats):
        rs = simp.get(fid) or [dp(max(feats[fid], key=area), 0.0005)]
        x0, y0, x1, y1 = bbox([[pr(p) for p in r] for r in rs])
        out[fid] = {'d': to_path(rs, pr), 'c': [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]}
    s = json.dumps({'viewBox': [round(w * scale), round(h * scale)], 'items': out}, separators=(',', ':'))
    open(P + f'src/data/maps/assembly/{slug}.json', 'w').write(s)
    print(slug, len(out), 'ACs', len(s) // 1024, 'KB', 'vertices', sum(len(r) for rs in feats.values() for r in rs), '->', sum(len(r) for rs in simp.values() for r in rs))
build_state(D + 'f15c5b36-vidhan_sabha_36.geojson', 'Telangana', 'telangana')
