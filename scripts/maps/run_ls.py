import json, sys, collections
sys.path.insert(0, '.')
from build_maps import *
D = '/mnt/user-data/attachments/d6785510-f880-53fa-a4cd-dc7679bc8c45/'
P = '/tmp/claude-0/-home-claude/d6785510-f880-53fa-a4cd-dc7679bc8c45/scratchpad/proj/election-game/'
EPS = float(sys.argv[1]) if len(sys.argv) > 1 else 0.012
rows = next(v for v in json.load(open(P + 'src/data/lok-sabha-constituencies-2024.json')).values() if isinstance(v, list))
SA = {'orissa': 'Odisha', 'delhi': 'Delhi', 'jammu & kashmir': 'Jammu and Kashmir', 'andaman & nicobar': 'Andaman & Nicobar Islands',
      'dadra & nagar haveli': 'Dadra & Nagar Haveli and Daman & Diu', 'daman & diu': 'Dadra & Nagar Haveli and Daman & Diu'}
ALIAS = {  # geojson PC name (normalised) -> game name (normalised); Assam shapes are the pre-2023 boundaries
 'tirupati': 'thirupathi', 'pondicherry': 'puducherry', 'kurnool': 'kurnoolu', 'anantapur': 'ananthapur', 'narasaraopet': 'narsaraopet',
 'dadraandnagarhaveli': 'dadarandnagarhaveli', 'hatkanangle': 'hatkanangale', 'anantnag': 'anantnagrajouri', 'hardwar': 'haridwar',
 'bahraich': 'baharaich', 'nainitaludhamsinghnagar': 'nainitaludhamsingh', 'bhiwanimahendragarh': 'bhiwani', 'tonksawaimadhopur': 'tonksawai',
 'pataliputra': 'patliputra', 'gauhati': 'guwahati', 'mangaldoi': 'darrangudalguri', 'nowgong': 'nagaon', 'tezpur': 'sonitpur',
 'kaliabor': 'kaziranga', 'autonomousdistrict': 'diphu', 'andamanandnicobar': 'andamanandnicobarislands'}
by = collections.defaultdict(dict)
for r in rows: by[r['state'].lower()][norm(r['name'])] = r
feats = {}; meta = {}
for f in json.load(open(D + '3dbbc061-lok_sabha.geojson'))['features']:
    p = f['properties']; st = SA.get(p['ST_NAME'].lower(), p['ST_NAME'].lower())
    if p['PC_NAME'].strip() == 'LADAKH': st = 'ladakh'
    k = norm(p['PC_NAME']); k = ALIAS.get(k, k)
    r = by[st.lower()].get(k)
    if r is None: raise SystemExit(f'unmatched {p}')
    assert r['id'] not in feats, r['id']
    feats[r['id']] = rings_of(f['geometry']); meta[r['id']] = (r['state'], r['name'])
assert len(feats) == 543
before = sum(len(x) for rs in feats.values() for x in rs)
simp = simplify_shared(feats, EPS, 0.0000015)
after = sum(len(x) for rs in simp.values() for x in rs)
proj = Proj(68.0, 37.2, 37.0, 0.92)
items = {}
for fid in sorted(feats):
    tiny = fid not in simp
    rs = simp.get(fid) or [dp(max(feats[fid], key=area), EPS / 6)]
    x0, y0, x1, y1 = bbox([[proj(p) for p in r] for r in rs])
    items[fid] = {'d': to_path(rs, proj), 'c': [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]}
    if tiny: items[fid]['tiny'] = 1
out = {'viewBox': [1000, 1130], 'items': items}
s = json.dumps(out, separators=(',', ':'))
os.makedirs(P + 'src/data/maps', exist_ok=True)
open(P + 'src/data/maps/india-constituencies.json', 'w').write(s)
print('vertices', before, '->', after, ' json KB', len(s) // 1024, ' missing', [i for i in feats if i not in simp])
