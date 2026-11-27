import json, sys, collections, difflib, re, math, os, glob
sys.path.insert(0, '.')
from build_maps import *
P = '/tmp/claude-0/-home-claude/d6785510-f880-53fa-a4cd-dc7679bc8c45/scratchpad/proj/election-game/'
Z = '/tmp/claude-0/-home-claude/d6785510-f880-53fa-a4cd-dc7679bc8c45/scratchpad/vs_zip/'
M = {'01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat','27':'Maharashtra','29':'Karnataka','30':'Goa','32':'Kerala','33':'Tamil Nadu','34':'Puducherry','37':'Andhra Pradesh'}
ALL = next(v for v in json.load(open(P + 'src/data/assembly-constituencies-2024.json')).values() if isinstance(v, list))
def clean(n): return re.sub(r'\s+', ' ', re.sub(r'\(\s*(SC|ST)?\s*\)?', '', n)).strip()
def slugify(s): return re.sub(r'[^a-z0-9]+', '-', s.lower().replace('&', 'and')).strip('-')
SLUG = {'Delhi': 'delhi'}
STRICT = {'Jammu and Kashmir': 0.8, 'Assam': 0.8}
ALIAS = {'Osmanabad': 'Dharashiv', 'Hoshangabad': 'Narmadapuram'}
def build(code, state):
    ac = [r for r in ALL if r['state'] == state]
    # group features by AC_ID+name (merge split pieces)
    groups = collections.OrderedDict()
    for f in json.load(open(Z + f'vidhan_sabha_{code}.geojson'))['features']:
        p = f['properties']; nm = clean(p['AC_NAME'])
        if not nm or not f['geometry']: continue
        key = (p['AC_ID'], norm(nm), norm(p['PC_NAME'] or ''))
        nm = ALIAS.get(nm, nm)
        g = groups.setdefault(key, {'nm': nm, 'pc': p['PC_NAME'] or '', 'rings': []})
        g['rings'] += rings_of(f['geometry'])
    gl = list(groups.values())
    pairs = []
    for i, g in enumerate(gl):
        for r in ac:
            s = difflib.SequenceMatcher(None, norm(g['nm']), norm(r['name'])).ratio()
            if norm(g['pc']) and norm(g['pc']) == norm(r['parentParliamentaryConstituency']): s += 0.15
            pairs.append((s, i, r['id']))
    pairs.sort(reverse=True)
    gi, ri, feats, weak = set(), set(), {}, []
    for s, i, rid in pairs:
        if i in gi or rid in ri: continue
        if s < STRICT.get(state, 0.45): break
        gi.add(i); ri.add(rid); feats[rid] = gl[i]['rings']
        if s < 0.85: weak.append((gl[i]['nm'], next(r['name'] for r in ac if r['id'] == rid), round(s, 2)))
    miss = [r['name'] for r in ac if r['id'] not in feats]
    extra = [gl[i]['nm'] for i in range(len(gl)) if i not in gi]
    simp = simplify_shared(feats, 0.004, 0.00000005)
    allp = [p for rs in feats.values() for r in rs for p in r]
    lons = [p[0] for p in allp]; lats = [p[1] for p in allp]
    kx = math.cos(math.radians((min(lats) + max(lats)) / 2))
    w = (max(lons) - min(lons)) * kx; h = max(lats) - min(lats)
    scale = 1000 / max(w, h); pr = Proj(min(lons), max(lats), scale, kx)
    out = {}
    for fid in sorted(feats):
        rs = simp.get(fid) or [dp(max(feats[fid], key=area), 0.0005)]
        x0, y0, x1, y1 = bbox([[pr(p) for p in r] for r in rs])
        out[fid] = {'d': to_path(rs, pr), 'c': [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]}
    s = json.dumps({'viewBox': [round(w * scale), round(h * scale)], 'items': out}, separators=(',', ':'))
    slug = SLUG.get(state, slugify(state))
    open(P + f'src/data/maps/assembly/{slug}.json', 'w').write(s)
    print(f'{slug}: {len(out)}/{len(ac)} ACs, {len(s)//1024} KB, weak {len(weak)}, missing {miss}, extra {extra}')
    for w_ in weak: print('   weak', w_)
for c, s in M.items(): build(c, s)
