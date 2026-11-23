import json
import sys

from shapely.geometry import MultiPolygon, shape
from shapely.ops import unary_union

LEFT_HAND = {
    'BGD', 'BTN', 'BRN', 'HKG', 'IND', 'IDN', 'JPN', 'MAC', 'MYS', 'MDV', 'NPL', 'PAK', 'SGP', 'LKA', 'THA', 'TLS',
    'AUS', 'FJI', 'KIR', 'NRU', 'NZL', 'PNG', 'WSM', 'SLB', 'TON', 'TUV', 'COK', 'NIU', 'NFK',
    'BWA', 'SWZ', 'KEN', 'LSO', 'MWI', 'MUS', 'MOZ', 'NAM', 'SYC', 'ZAF', 'TZA', 'UGA', 'ZMB', 'ZWE', 'SHN',
    'GBR', 'IRL', 'CYP', 'CYN', 'CNM', 'MLT', 'IMN', 'JEY', 'GGY', 'ESB', 'WSB',
    'ATG', 'BHS', 'BRB', 'DMA', 'GRD', 'GUY', 'JAM', 'KNA', 'LCA', 'VCT', 'SUR', 'TTO',
    'AIA', 'BMU', 'VGB', 'CYM', 'FLK', 'MSR', 'TCA', 'VIR',
}

COAST_BUFFER = 0.15
COAST_TOLERANCE = 0.03
TOLERANCE = 0.004
MIN_AREA = 1e-5
SCALE = 1000


def encode_value(value):
    v = ~(value << 1) if value < 0 else value << 1
    out = []
    while v >= 0x20:
        out.append(chr((0x20 | (v & 0x1f)) + 63))
        v >>= 5
    out.append(chr(v + 63))
    return ''.join(out)


def encode_ring(coords):
    out = []
    px = py = 0
    previous = None
    for lng, lat in coords:
        x, y = round(lng * SCALE), round(lat * SCALE)
        if (x, y) == previous:
            continue
        out.append(encode_value(x - px) + encode_value(y - py))
        px, py = x, y
        previous = (x, y)
    return ''.join(out) if len(out) >= 4 else ''


def main(path):
    data = json.load(open(path, encoding='utf-8'))
    left, right = [], []
    found = set()
    for feature in data['features']:
        code = feature['properties'].get('ADM0_A3')
        geometry = shape(feature['geometry']).buffer(0)
        if code in LEFT_HAND:
            left.append(geometry)
            found.add(code)
        else:
            right.append(geometry)
    zone = unary_union(left).buffer(COAST_BUFFER, quad_segs=3).simplify(COAST_TOLERANCE, preserve_topology=True)
    blocking = unary_union([g for g in right if g.intersects(zone)]).simplify(TOLERANCE, preserve_topology=True)
    region = zone.difference(blocking).simplify(TOLERANCE, preserve_topology=True)
    parts = list(region.geoms) if isinstance(region, MultiPolygon) else [region]
    encoded = []
    for polygon in parts:
        if polygon.area < MIN_AREA:
            continue
        rings = [encode_ring(polygon.exterior.coords)]
        rings += [encode_ring(r.coords) for r in polygon.interiors if r.envelope.area >= MIN_AREA]
        rings = [r for r in rings if r]
        if rings:
            encoded.append(' '.join(rings))
    missing = sorted(LEFT_HAND - found)
    sys.stderr.write(f"{len(found)} territories, {len(encoded)} polygons, missing: {', '.join(missing)}" + chr(10))
    sys.stdout.write(','.join(encoded))


if __name__ == '__main__':
    main(sys.argv[1])
