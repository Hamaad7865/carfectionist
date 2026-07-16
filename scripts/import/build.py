"""Turn the owner's Cashmag exports into one clean JSON payload for the importer.

All the judgement lives here (and only here), so it can be re-run and re-read:

  • SERVICES come from `services price.xlsx` — that list is the owner's authority
    on what is a service. Everything else in the products export is a product.
  • The generic auto-parts taxonomy (19 categories where EVERY row is zero-priced
    — Brake Pads, Airbags, Windshield, Suspension …) is dropped. It shipped inside
    the Cashmag export but is not this studio's stock.
  • Duplicates collapse to the HIGHEST price (the owner's rule). Two passes:
      1. normalised name  — catches case/space/dash/encoding variants
      2. battery code     — "40 100 - Battery 12v…" and "ENERGY 40 100" are the
                            same battery under two naming systems; no text-similarity
                            measure catches that, the shared code does.
  • Real distinctions are NEVER merged: volume (25L vs 5L), vehicle model, size,
    colour, scent, duration (3 vs 6 months protection). Only the two rules above
    merge anything, and both are exact-identity, not fuzzy.

Usage:  python scripts/import/build.py            # writes payload + prints the report
"""
import csv, json, os, re, sys, unicodedata
sys.path.insert(0, os.path.dirname(__file__))
from _xlsx import read_xlsx

DL = r"C:\Users\sheik\Downloads"
OUT = os.path.join(os.path.dirname(__file__), "payload.json")

SERVICES_XLSX = os.path.join(DL, "services price.xlsx")
PRODUCTS_XLSX = os.path.join(DL, "export_produits_2026-07-07 07_43_43_6a4c920fbdf31.xlsx")
SHOP_XLSX     = os.path.join(DL, "STOCK SHOP.xlsx")
WHSE_XLSX     = os.path.join(DL, "STOCK WAREHOUSE.xlsx")
CLIENTS_CSV   = os.path.join(DL, "INDIVIDUAL CLIENT.csv")  # COMPANY CLIENT.csv is byte-identical

def col(row, *needles):
    """Columns arrive mojibake'd (Libell?, Co?t) — match on a substring."""
    for k in row:
        for n in needles:
            if n.lower() in k.lower():
                return k
    return None

def fix_text(s):
    """Repair the Latin-1-read-as-UTF-8 mojibake, then normalise punctuation."""
    if not s:
        return ""
    try:
        s = s.encode("cp1252", "ignore").decode("utf-8", "ignore") or s
    except Exception:
        pass
    s = unicodedata.normalize("NFKC", s)
    return re.sub(r"\s+", " ", s).strip()

def norm(s):
    """Identity key: case-fold, unify dashes, drop punctuation, collapse spaces."""
    s = fix_text(s).lower()
    s = re.sub(r"[‐-―−]", "-", s)   # – — ‒ ⁃ − → -
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

MAX_MONEY = 9_999_999.0  # nothing this studio sells costs eight figures

def money(v, field="", name=""):
    if v is None or str(v).strip() == "":
        return 0.0
    try:
        n = round(float(str(v).replace(",", "").strip()), 2)
    except ValueError:
        return 0.0
    if abs(n) > MAX_MONEY:
        # e.g. 2147483647 (INT32_MAX) — a sentinel, not a price. Don't let it
        # blow up the insert or, worse, land as a real figure.
        SUSPECT.append({"name": name, "field": field, "value": n})
        return 0.0
    return n

SUSPECT = []

def battery_code(name, category):
    """`40 100 - Battery 12v…` and `ENERGY 40 100` are one battery; `S40.500` and
    `S40 500` likewise. Only applied inside BATTERY categories, so a code-like
    number in an unrelated product name can never merge anything."""
    if not category.upper().startswith("BATTERY"):
        return None
    n = fix_text(name).upper()
    m = re.search(r"\b(S?\d{2})[\s.\-]?(\d{3})\b", n)
    return f"{m.group(1)}{m.group(2)}" if m else None

# ── load ────────────────────────────────────────────────────────────────────
svc_rows  = read_xlsx(SERVICES_XLSX)
prod_rows = read_xlsx(PRODUCTS_XLSX)
k = svc_rows[0]
C_CAT, C_NAME, C_PRICE = col(k, "Rubrique"), col(k, "Libell"), col(k, "SALES")
C_ID, C_COST, C_BAR, C_THRESH = col(k, "#ID"), col(k, "revient"), col(k, "barre"), col(k, "Seuil")

def take(rows, kind):
    out = []
    for r in rows:
        name = fix_text(r.get(C_NAME) or r.get(col(r, "Abr")) or "")
        if not name:
            continue
        out.append({
            "name": name,
            "category": fix_text(r.get(C_CAT) or "") or None,
            "price": money(r.get(C_PRICE), "price", name),
            "cost": money(r.get(C_COST), "cost", name),
            "barcode": (fix_text(r.get(C_BAR)) or None) if C_BAR else None,
            "threshold": money(r.get(C_THRESH), "threshold", name),
            "cashmag_id": fix_text(r.get(C_ID) or ""),
            "kind": kind,
        })
    return out

services = take(svc_rows, "service")
products = take(prod_rows, "product")

report = {"dropped_parts_taxonomy": 0, "dropped_parts_categories": [], "merged": [], "zero_priced": [],
          "unmatched_stock": [], "ambiguous_stock": [], "created_from_stock": []}

# ── 1. drop the generic auto-parts taxonomy (every row in the category is 0) ──
by_cat = {}
for p in products:
    by_cat.setdefault(p["category"] or "(none)", []).append(p)
junk_cats = {c for c, rows in by_cat.items() if rows and all(r["price"] == 0 for r in rows)}
report["dropped_parts_categories"] = sorted(junk_cats)
kept = [p for p in products if (p["category"] or "(none)") not in junk_cats]
report["dropped_parts_taxonomy"] = len(products) - len(kept)
products = kept

# ── 2. the owner's service list wins: drop those names from products ──────────
svc_keys = {norm(s["name"]) for s in services}
before = len(products)
products = [p for p in products if norm(p["name"]) not in svc_keys]
report["products_that_were_services"] = before - len(products)

# ── 3. dedupe → highest price ────────────────────────────────────────────────
# ALIAS is the safety net: when two rows merge, the loser's name still appears in
# the stock files. Without this, that stock silently vanishes — the dry run showed
# 45 such rows (e.g. the shop's "ENERGY 40 100" stock, once "40 100- Battery…" won).
ALIAS = {}

def dedupe(rows, label):
    groups = {}
    for r in rows:
        key = battery_code(r["name"], r["category"] or "") or norm(r["name"])
        groups.setdefault(key, []).append(r)
    out = []
    for key, g in groups.items():
        g_sorted = sorted(g, key=lambda x: x["price"], reverse=True)
        winner = dict(g_sorted[0])
        if len(g) > 1:
            # the winner keeps the highest price AND any barcode/cost its twins had
            for other in g_sorted[1:]:
                winner["barcode"] = winner.get("barcode") or other.get("barcode")
                winner["cost"] = winner["cost"] or other["cost"]
            report["merged"].append({
                "scope": label, "kept": winner["name"], "price": winner["price"],
                "dropped": [{"name": o["name"], "price": o["price"], "id": o["cashmag_id"]} for o in g_sorted[1:]],
                "by": "battery-code" if battery_code(winner["name"], winner["category"] or "") else "name",
            })
        # every variant — winner included — points at the surviving name
        for member in g_sorted:
            ALIAS[norm(member["name"])] = winner["name"]
            bc = battery_code(member["name"], member["category"] or "")
            if bc:
                ALIAS["bc:" + bc] = winner["name"]
        out.append(winner)
    return out

services = dedupe(services, "service")
products = dedupe(products, "product")

# ── 4. flag broken prices (imported anyway, per the owner's call) ─────────────
for r in services + products:
    if r["price"] <= 0:
        report["zero_priced"].append({"name": r["name"], "category": r["category"], "id": r["cashmag_id"], "price": r["price"]})

# ── 5. clients ───────────────────────────────────────────────────────────────
clients = []
with open(CLIENTS_CSV, "r", encoding="utf-8-sig", errors="replace") as f:
    for row in csv.DictReader(f, delimiter=";"):
        company = fix_text(row.get("Société") or row.get("Societe") or "")
        person = " ".join(x for x in [fix_text(row.get("Nom") or ""), fix_text(row.get("Prénom") or row.get("Prenom") or "")] if x)
        name = company or person
        if not name:
            continue
        clients.append({
            "name": name,
            "is_company": bool(company),
            "phone": fix_text(row.get("Mobile") or row.get("Fixe") or "") or None,
            "email": fix_text(row.get("Adresse mail") or "") or None,
            "address": fix_text(row.get("Adresse") or "") or None,
        })
# a customer can legitimately repeat in the export — keep one row per name
seen, uniq = set(), []
for c in clients:
    if norm(c["name"]) in seen:
        continue
    seen.add(norm(c["name"]))
    uniq.append(c)
report["clients_duplicates_collapsed"] = len(clients) - len(uniq)
clients = uniq

# ── 6. stock (matched to the kept catalogue by name) ──────────────────────────
live = {norm(p["name"]): p["name"] for p in products + services}

def resolve(name, category):
    """Stock name → the catalogue item it belongs to, following merges.

    The two exports name things slightly differently ("TS-B350PRO 250 W" in stock
    vs "TS-B350PRO" in the catalogue), so an exact key alone loses real stock. The
    prefix rule bridges that — but ONLY when exactly one candidate matches. If two
    could match (e.g. a stock "MAX FOAM SHAMPOO" against a 1L and a 5L), that's a
    size question we must not answer by guessing: leave it for a human.
    """
    key = norm(name)
    if key in live:
        return live[key]
    if key in ALIAS:
        return ALIAS[key]
    bc = battery_code(name, category or "BATTERY")  # stock files carry their own Rubrique
    if bc and ("bc:" + bc) in ALIAS:
        return ALIAS["bc:" + bc]
    # unambiguous prefix match, either direction
    if len(key) >= 8:
        cands = {v for k, v in live.items() if k.startswith(key) or key.startswith(k)}
        if len(cands) == 1:
            return next(iter(cands))
        if len(cands) > 1:
            report["ambiguous_stock"].append({"name": name, "candidates": sorted(cands)[:4]})
    return None

def stock(path, location):
    rows = read_xlsx(path)
    kk = rows[0]
    cn, cq, cc = col(kk, "Produit"), col(kk, "Stock"), col(kk, "Rubrique")
    out = []
    for r in rows:
        nm = fix_text(r.get(cn) or "")
        if not nm:
            continue
        qty = money(r.get(cq))
        target = resolve(nm, fix_text(r.get(cc) or "") if cc else "")
        if not target:
            # not a mistake to hide: either the item was dropped with the parts
            # taxonomy, or the owner holds stock of something not in the catalogue
            report["unmatched_stock"].append({"name": nm, "location": location, "qty": qty})
            continue
        if qty:
            out.append({"product": target, "location": location, "qty": qty})
    return out

movements = stock(SHOP_XLSX, "Shop") + stock(WHSE_XLSX, "Warehouse")

# ── 6b. stock we HOLD but the products export never listed ───────────────────
# 34 units of "FABRIC SEAT AND CARPET PROTECTION", the car diffusers, the 5L
# variants… Real stock. Dropping it would quietly understate the shop. Create the
# item at price 0 and flag it — a zero-priced item can't be sold by accident (it
# would ring up free), so this is visible, not silent.
missing = {}
for u in report["unmatched_stock"]:
    if u["qty"] > 0:
        missing.setdefault(norm(u["name"]), u["name"])
for key, nm in missing.items():
    products.append({"name": nm, "category": "UNCATEGORISED", "price": 0.0, "cost": 0.0,
                     "barcode": None, "threshold": 0.0, "cashmag_id": "", "kind": "product"})
    live[key] = nm
    report["created_from_stock"].append(nm)
    report["zero_priced"].append({"name": nm, "category": "UNCATEGORISED", "id": "", "price": 0.0})
# re-run the stock pass now those items exist, so their quantities land
report["suspect_values"] = SUSPECT
report["placeholder_prices"] = [{"name": r["name"], "price": r["price"]} for r in services + products if r["price"] >= 999999]
report["unmatched_stock"] = []
movements = stock(SHOP_XLSX, "Shop") + stock(WHSE_XLSX, "Warehouse")

payload = {"services": services, "products": products, "clients": clients, "movements": movements}
with open(os.path.join(os.path.dirname(__file__), "report.json"), "w", encoding="utf-8") as rf:
    json.dump(report, rf, ensure_ascii=False, indent=1)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

# ── report ───────────────────────────────────────────────────────────────────
print("=" * 68)
print("SERVICES  ", len(services))
print("PRODUCTS  ", len(products))
print("CLIENTS   ", len(clients), f"({report['clients_duplicates_collapsed']} duplicate names collapsed)")
print("STOCK      ", len(movements), "movements  |  unmatched:", len(report["unmatched_stock"]),
      " | ambiguous:", len(report["ambiguous_stock"]), " | created from stock:", len(report["created_from_stock"]))
print()
print("dropped auto-parts taxonomy:", report["dropped_parts_taxonomy"], "rows in", len(report["dropped_parts_categories"]), "categories")
print("products that were really services:", report["products_that_were_services"])
print("merged duplicate groups:", len(report["merged"]),
      "(by battery code:", sum(1 for m in report["merged"] if m["by"] == "battery-code"), ")")
print("zero-priced items kept + flagged:", len(report["zero_priced"]))
print()
print("--- merges (highest price kept) ---")
for m in report["merged"][:14]:
    print(f"  [{m['by']:12}] {m['kept'][:44]:46} Rs {m['price']:>9,.2f}   dropped: " +
          ", ".join(f"{d['name'][:26]}@{d['price']:,.0f}" for d in m["dropped"]))
if len(report["merged"]) > 14:
    print(f"  … {len(report['merged']) - 14} more")
print()
print("--- zero-priced (owner must price these) ---")
for z in report["zero_priced"][:12]:
    print(f"  {z['name'][:48]:50} {z['category'] or '-':22} #{z['id']}")
if len(report["zero_priced"]) > 12:
    print(f"  … {len(report['zero_priced']) - 12} more")
print()
print("--- stock rows with no matching catalogue item ---")
for u in report["unmatched_stock"][:8]:
    print(f"  {u['location']:10} {u['name'][:46]:48} qty {u['qty']}")
if len(report["unmatched_stock"]) > 8:
    print(f"  … {len(report['unmatched_stock']) - 8} more")
print("=" * 68)
print("payload ->", OUT)
