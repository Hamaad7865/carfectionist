"""Minimal xlsx reader (stdlib only) for the owner's Cashmag exports."""
import zipfile, xml.etree.ElementTree as ET, re
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def _colidx(ref):
    s = ''.join(ch for ch in ref if ch.isalpha()); n = 0
    for ch in s: n = n * 26 + (ord(ch) - 64)
    return n - 1

def read_xlsx(path):
    z = zipfile.ZipFile(path); strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        r = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in r.findall('m:si', NS):
            strings.append(''.join(t.text or '' for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')))
    sh = [x for x in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml', x)][0]
    root = ET.fromstring(z.read(sh))
    raw = []
    for row in root.find('m:sheetData', NS).findall('m:row', NS):
        d = {}
        for c in row.findall('m:c', NS):
            t = c.get('t'); v = c.find('m:v', NS); isv = c.find('m:is/m:t', NS)
            val = strings[int(v.text)] if t == 's' and v is not None else (
                  isv.text if t == 'inlineStr' and isv is not None else (v.text if v is not None else ''))
            d[_colidx(c.get('r'))] = val
        raw.append(d)
    hdr = raw[0]; n = max(hdr) + 1
    return [{(hdr.get(i) or f'col{i}'): r.get(i, '') for i in range(n)} for r in raw[1:]]
