"""Convert raw OpenStreetMap (Overpass) data around PES University RR campus into compact game data.
Origin = centroid of the OSM 'Golden Jubilee Block (GJBC)' outline. Metres, +X east, +Z south.
Run: python3 tools/osm/extract.py  (reads tools/osm/osm_raw.json, writes src/world/data/osm.json)
Needs shapely.  Data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, hashlib
from shapely.geometry import Polygon, LineString, box
here = os.path.dirname(__file__)
raw = json.load(open(os.path.join(here, 'osm_raw.json')))
nodes = {e['id']: (e['lat'], e['lon']) for e in raw['elements'] if e['type'] == 'node'}
ways = [e for e in raw['elements'] if e['type'] == 'way' and 'tags' in e]
LAT0, LON0 = 12.933976730000001, 77.5345492
KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
def xz(n):
    la, lo = nodes[n]; return ((lo - LON0) * KX, -(la - LAT0) * KZ)
# campus buildings are authored by hand in src/world/layout.ts
CAMPUS_IDS = {1257468893, 424687846, 199316438, 199315793, 351161043, 347418529, 691137806, 691138811, 199316660, 1182315667}
AREA = box(-420, -420, 420, 360)
out = {'attribution': 'Map data (c) OpenStreetMap contributors, ODbL', 'origin_latlon': [LAT0, LON0], 'buildings': [], 'roads': []}
WIDTH = {'trunk': 11, 'trunk_link': 7, 'secondary': 9, 'tertiary': 8, 'residential': 6, 'service': 5, 'unclassified': 6, 'living_street': 5}
for w in ways:
    t = w['tags']
    pts = [xz(n) for n in w['nodes'] if n in nodes]
    if len(pts) < 2: continue
    if 'building' in t and w['id'] not in CAMPUS_IDS and w['nodes'][0] == w['nodes'][-1] and len(pts) >= 4:
        poly = Polygon(pts)
        if not poly.is_valid: poly = poly.buffer(0)
        if poly.geom_type != 'Polygon' or poly.area < 12 or not poly.intersects(AREA): continue
        poly = poly.simplify(0.4)
        h = int(hashlib.md5(str(w['id']).encode()).hexdigest()[:8], 16)
        lv = t.get('building:levels')
        try: levels = max(1, min(20, int(float(lv))))
        except (TypeError, ValueError): levels = [2, 2, 3, 3, 3, 4, 2, 1][h % 8] if poly.area > 40 else 1
        coords = list(poly.exterior.coords)[:-1]
        if Polygon(coords).exterior.is_ccw: coords = coords[::-1]
        out['buildings'].append({'id': w['id'], 'levels': levels, 'seed': h % 100000, 'pts': [[round(x, 1), round(z, 1)] for x, z in coords]})
    elif t.get('highway') in WIDTH:
        line = LineString(pts)
        if not line.intersects(AREA): continue
        out['roads'].append({'kind': t['highway'], 'name': t.get('name', ''), 'width': WIDTH[t['highway']], 'oneway': t.get('oneway') == 'yes', 'layer': int(t.get('layer', 0) or 0), 'bridge': t.get('bridge') == 'yes', 'pts': [[round(x, 1), round(z, 1)] for x, z in pts]})
dst = os.path.join(here, '..', '..', 'src', 'world', 'data', 'osm.json')
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print('buildings', len(out['buildings']), 'roads', len(out['roads']), 'bytes', os.path.getsize(dst))
