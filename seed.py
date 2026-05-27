from auth import hash_pin, normalize_store_code
from database import get_db, init_db, utc_now

# (name, category, barcode, unit, on_hand, par, aisle)
SAMPLE_ITEMS = [
    # ── Energy & soft drinks ──
    ("Red Bull 250ml", "Energy Drinks", "62907100201", "each", 18, 24, "Aisle 1"),
    ("Monster Original 473ml", "Energy Drinks", "70847811264", "each", 12, 20, "Aisle 1"),
    ("Monster Ultra Zero", "Energy Drinks", "70847811265", "each", 9, 16, "Aisle 1"),
    ("Rockstar Original 473ml", "Energy Drinks", "81809400101", "each", 6, 12, "Aisle 1"),
    ("Coca-Cola 591ml", "Soft Drinks", "06700000103", "each", 36, 48, "Aisle 2"),
    ("Pepsi 591ml", "Soft Drinks", "01200000102", "each", 8, 48, "Aisle 2"),
    ("Canada Dry Ginger Ale 591ml", "Soft Drinks", "06200000401", "each", 14, 24, "Aisle 2"),
    ("Sprite 591ml", "Soft Drinks", "06700000104", "each", 11, 24, "Aisle 2"),
    ("Dasani Water 500ml", "Water", "06700000401", "each", 42, 36, "Aisle 2"),
    ("Gatorade Blue 591ml", "Sports Drinks", "05200033801", "each", 6, 18, "Aisle 2"),
    # ── Snacks & grocery ──
    ("Lay's Classic 235g", "Snacks", "02840000001", "each", 22, 24, "Aisle 3"),
    ("Doritos Nacho 235g", "Snacks", "02840000456", "each", 4, 20, "Aisle 3"),
    ("Ruffles All Dressed", "Snacks", "02840000457", "each", 7, 16, "Aisle 3"),
    ("Kit Kat Bar", "Candy", "06680000001", "each", 30, 24, "Aisle 3"),
    ("Snickers Bar", "Candy", "04000000001", "each", 5, 24, "Aisle 3"),
    ("Milk 2L Whole", "Dairy", "06680000002", "each", 6, 8, "Aisle 4"),
    ("Bread White Loaf", "Bakery", None, "each", 4, 6, "Aisle 4"),
    ("Coffee Large Cup", "Hot Beverages", None, "each", 0, 0, "Counter"),
    ("Hot Dog Roller", "Food Service", None, "each", 12, 20, "Counter"),
    ("Bag of Ice 7kg", "Frozen", None, "each", 2, 10, "Freezer"),
    ("AA Batteries 4pk", "General Merch", "39800000001", "pack", 9, 12, "Aisle 5"),
    ("Tylenol Extra Strength 24ct", "Health", "30045000001", "each", 7, 8, "Aisle 5"),
    ("Paper Towels 2pk", "General Merch", None, "case", 1, 3, "Aisle 5"),

    # ── Cigarettes ──
    ("Marlboro Red King Size", "Tobacco", "02820000401", "pack", 14, 20, "Tobacco Wall"),
    ("Marlboro Gold King Size", "Tobacco", "02820000402", "pack", 11, 18, "Tobacco Wall"),
    ("Marlboro Menthol King Size", "Tobacco", "02820000403", "pack", 8, 14, "Tobacco Wall"),
    ("Export A King Size", "Tobacco", "06040100001", "pack", 16, 22, "Tobacco Wall"),
    ("Export A Medium King Size", "Tobacco", "06040100002", "pack", 10, 16, "Tobacco Wall"),
    ("Canadian Classics Original", "Tobacco", "06040100003", "pack", 18, 24, "Tobacco Wall"),
    ("Canadian Classics Silver", "Tobacco", "06040100004", "pack", 12, 18, "Tobacco Wall"),
    ("Player's Original King Size", "Tobacco", "06040100005", "pack", 9, 16, "Tobacco Wall"),
    ("Player's Plain King Size", "Tobacco", "06040100006", "pack", 7, 14, "Tobacco Wall"),
    ("du Maurier Regular King Size", "Tobacco", "06040100007", "pack", 13, 18, "Tobacco Wall"),
    ("du Maurier Light King Size", "Tobacco", "06040100008", "pack", 8, 14, "Tobacco Wall"),
    ("du Maurier Ultra Light King Size", "Tobacco", "06040100009", "pack", 5, 12, "Tobacco Wall"),
    ("Belmont Original King Size", "Tobacco", "06040100010", "pack", 6, 12, "Tobacco Wall"),
    ("Nexus Full Flavour King Size", "Tobacco", "06040100011", "pack", 10, 16, "Tobacco Wall"),
    ("Nexus Light King Size", "Tobacco", "06040100012", "pack", 4, 12, "Tobacco Wall"),
    ("Rothmans King Size", "Tobacco", "06040100013", "pack", 7, 14, "Tobacco Wall"),
    ("Next Red King Size", "Tobacco", "06040100014", "pack", 9, 14, "Tobacco Wall"),
    ("Next Blue King Size", "Tobacco", "06040100015", "pack", 6, 12, "Tobacco Wall"),
    ("MacDonald Special King Size", "Tobacco", "06040100016", "pack", 5, 10, "Tobacco Wall"),
    ("Putters Light King Size", "Tobacco", "06040100017", "pack", 4, 10, "Tobacco Wall"),
    ("Matinee Regular King Size", "Tobacco", "06040100018", "pack", 3, 10, "Tobacco Wall"),
    ("Craven A King Size", "Tobacco", "06040100019", "pack", 8, 14, "Tobacco Wall"),
    ("John Player Bold King Size", "Tobacco", "06040100020", "pack", 6, 12, "Tobacco Wall"),
    ("John Player Rich King Size", "Tobacco", "06040100021", "pack", 5, 12, "Tobacco Wall"),
    ("Pall Mall Red King Size", "Tobacco", "06040100022", "pack", 4, 10, "Tobacco Wall"),
    ("Pall Mall Blue King Size", "Tobacco", "06040100023", "pack", 3, 10, "Tobacco Wall"),

    # ── Nicotine pouches & oral tobacco ──
    ("Zyn Wintergreen 6mg", "Tobacco", "84200000001", "pack", 3, 12, "Counter"),
    ("Zyn Cool Mint 6mg", "Tobacco", "84200000002", "pack", 8, 14, "Counter"),
    ("Zyn Spearmint 3mg", "Tobacco", "84200000003", "pack", 6, 12, "Counter"),
    ("Zyn Citrus 6mg", "Tobacco", "84200000004", "pack", 4, 10, "Counter"),
    ("Zyn Coffee 6mg", "Tobacco", "84200000005", "pack", 2, 8, "Counter"),
    ("Velo Peppermint 4mg", "Tobacco", "84200000006", "pack", 5, 10, "Counter"),
    ("Velo Citrus 4mg", "Tobacco", "84200000007", "pack", 3, 8, "Counter"),
    ("ON! Mint 4mg", "Tobacco", "84200000008", "pack", 4, 8, "Counter"),
    ("ON! Citrus 4mg", "Tobacco", "84200000009", "pack", 2, 6, "Counter"),
    ("White Fox Peppermint", "Tobacco", "84200000010", "pack", 3, 8, "Counter"),
    ("Copenhagen Long Cut", "Tobacco", "84200000011", "each", 2, 6, "Counter"),
    ("Skoal Wintergreen Pouch", "Tobacco", "84200000012", "each", 1, 4, "Counter"),

    # ── Cigars, papers & accessories ──
    ("Backwoods Honey Bourbon 5pk", "Tobacco", "84200000020", "pack", 6, 12, "Counter"),
    ("Dutch Masters Palma 2pk", "Tobacco", "84200000021", "pack", 4, 10, "Counter"),
    ("Phillies Blunt Original", "Tobacco", "84200000022", "each", 8, 16, "Counter"),
    ("Swisher Sweets Grape", "Tobacco", "84200000023", "each", 5, 12, "Counter"),
    ("Zig-Zag Orange 1.25 Papers", "Tobacco", "84200000024", "pack", 10, 16, "Counter"),
    ("RAW Classic 1.25 Papers", "Tobacco", "84200000025", "pack", 7, 14, "Counter"),
    ("Bic Lighter", "Tobacco", "84200000026", "each", 18, 24, "Counter"),
    ("Clipper Lighter", "Tobacco", "84200000027", "each", 6, 12, "Counter"),
    ("Vuse Alto Golden Tobacco Pod", "Tobacco", "84200000028", "each", 3, 8, "Counter"),
    ("Vuse Alto Menthol Pod", "Tobacco", "84200000029", "each", 2, 6, "Counter"),

    # ── Beer ──
    ("Budweiser 6-pack 355ml", "Beer", "06206700401", "pack", 14, 18, "Beer Cooler"),
    ("Budweiser Single 473ml", "Beer", "06206700402", "each", 22, 30, "Beer Cooler"),
    ("Coors Light 6-pack 355ml", "Beer", "06206700403", "pack", 12, 18, "Beer Cooler"),
    ("Coors Light Single 473ml", "Beer", "06206700404", "each", 18, 24, "Beer Cooler"),
    ("Molson Canadian 6-pack 355ml", "Beer", "06206700405", "pack", 16, 20, "Beer Cooler"),
    ("Molson Canadian 12-pack 355ml", "Beer", "06206700406", "pack", 5, 10, "Beer Cooler"),
    ("Labatt Blue 6-pack 355ml", "Beer", "06206700407", "pack", 10, 16, "Beer Cooler"),
    ("Labatt Blue Single 473ml", "Beer", "06206700408", "each", 15, 20, "Beer Cooler"),
    ("Blue Moon Belgian White 6-pack", "Beer", "06206700409", "pack", 4, 8, "Beer Cooler"),
    ("Corona Extra 6-pack 330ml", "Beer", "06206700410", "pack", 8, 12, "Beer Cooler"),
    ("Corona Extra Single 330ml", "Beer", "06206700411", "each", 12, 18, "Beer Cooler"),
    ("Heineken 6-pack 330ml", "Beer", "06206700412", "pack", 6, 10, "Beer Cooler"),
    ("Stella Artois 6-pack 330ml", "Beer", "06206700413", "pack", 5, 8, "Beer Cooler"),
    ("Miller Lite 6-pack 355ml", "Beer", "06206700414", "pack", 4, 8, "Beer Cooler"),
    ("Busch Lager 6-pack 355ml", "Beer", "06206700415", "pack", 6, 10, "Beer Cooler"),
    ("Keith's IPA 6-pack 341ml", "Beer", "06206700416", "pack", 3, 8, "Beer Cooler"),
    ("Sleeman Clear 2.0 6-pack", "Beer", "06206700417", "pack", 4, 8, "Beer Cooler"),
    ("Moosehead Lager 6-pack 341ml", "Beer", "06206700418", "pack", 5, 8, "Beer Cooler"),
    ("Guinness Draught 4-pack 440ml", "Beer", "06206700419", "pack", 2, 6, "Beer Cooler"),
    ("Modelo Especial 6-pack 355ml", "Beer", "06206700420", "pack", 4, 8, "Beer Cooler"),

    # ── Coolers & cider ──
    ("White Claw Black Cherry 6-pack", "Coolers & Cider", "06206700501", "pack", 7, 12, "Beer Cooler"),
    ("White Claw Mango 6-pack", "Coolers & Cider", "06206700502", "pack", 5, 10, "Beer Cooler"),
    ("Truly Lime 6-pack", "Coolers & Cider", "06206700503", "pack", 4, 8, "Beer Cooler"),
    ("Smirnoff Ice Original 6-pack", "Coolers & Cider", "06206700504", "pack", 6, 10, "Beer Cooler"),
    ("Mike's Hard Lemonade 6-pack", "Coolers & Cider", "06206700505", "pack", 3, 8, "Beer Cooler"),
    ("Somersby Apple Cider 4-pack", "Coolers & Cider", "06206700506", "pack", 4, 8, "Beer Cooler"),
    ("Strongbow Gold Apple 4-pack", "Coolers & Cider", "06206700507", "pack", 2, 6, "Beer Cooler"),

    # ── Wine ──
    ("Jackson-Triggs Merlot 750ml", "Wine", "06206700601", "each", 5, 8, "Wine Rack"),
    ("Jackson-Triggs Pinot Grigio 750ml", "Wine", "06206700602", "each", 4, 8, "Wine Rack"),
    ("Jacob's Creek Shiraz 750ml", "Wine", "06206700603", "each", 3, 6, "Wine Rack"),
    ("Naked Grape Pinot Grigio 750ml", "Wine", "06206700604", "each", 4, 6, "Wine Rack"),
    ("Bodacious Smooth Red 750ml", "Wine", "06206700605", "each", 6, 8, "Wine Rack"),
    ("Apothic Red 750ml", "Wine", "06206700606", "each", 2, 4, "Wine Rack"),
    ("Yellow Tail Chardonnay 750ml", "Wine", "06206700607", "each", 3, 6, "Wine Rack"),
    ("Barefoot Moscato 750ml", "Wine", "06206700608", "each", 4, 6, "Wine Rack"),
    ("Black Tower Riesling 750ml", "Wine", "06206700609", "each", 2, 4, "Wine Rack"),
    ("Copper Moon Merlot 750ml", "Wine", "06206700610", "each", 3, 5, "Wine Rack"),

    # ── Spirits ──
    ("Smirnoff Vodka 750ml", "Spirits", "06206700701", "each", 3, 5, "Spirits Shelf"),
    ("Absolut Vodka 750ml", "Spirits", "06206700702", "each", 2, 4, "Spirits Shelf"),
    ("Captain Morgan Spiced Rum 750ml", "Spirits", "06206700703", "each", 2, 4, "Spirits Shelf"),
    ("Bacardi White Rum 750ml", "Spirits", "06206700704", "each", 2, 4, "Spirits Shelf"),
    ("Jameson Irish Whiskey 750ml", "Spirits", "06206700705", "each", 2, 4, "Spirits Shelf"),
    ("Crown Royal 750ml", "Spirits", "06206700706", "each", 2, 3, "Spirits Shelf"),
    ("Jägermeister 750ml", "Spirits", "06206700707", "each", 1, 3, "Spirits Shelf"),
    ("Fireball Cinnamon Whisky 750ml", "Spirits", "06206700708", "each", 3, 5, "Spirits Shelf"),
    ("Jack Daniel's Old No.7 750ml", "Spirits", "06206700709", "each", 2, 3, "Spirits Shelf"),
    ("Baileys Original 750ml", "Spirits", "06206700710", "each", 1, 3, "Spirits Shelf"),
    ("Tanqueray Gin 750ml", "Spirits", "06206700711", "each", 1, 2, "Spirits Shelf"),
    ("Bombay Sapphire Gin 750ml", "Spirits", "06206700712", "each", 1, 2, "Spirits Shelf"),
    ("Hennessy VS 750ml", "Spirits", "06206700713", "each", 1, 2, "Spirits Shelf"),
    ("Patron Silver Tequila 750ml", "Spirits", "06206700714", "each", 1, 2, "Spirits Shelf"),
]

DEMO_STORE_CODE = "cornershop"
DEMO_PIN = "1234"


def _balanced_stock(par: float, index: int) -> float:
    """Spread demo stock: ~20% low, ~20% overstock, ~60% healthy."""
    if par <= 0:
        return 0.0
    bucket = index % 10
    if bucket < 2:
        return round(max(par * (0.25 + (index % 3) * 0.08), 0), 1)
    if bucket >= 8:
        return round(par * (1.6 + (index % 3) * 0.15), 1)
    return round(par * (1.05 + (bucket % 6) * 0.06), 1)


def _upsert_items(conn, business_id: int, now: str) -> None:
    """Insert missing demo items; refresh aisle and rebalance stock on existing ones."""
    for idx, (name, category, barcode, unit, _oh, par, aisle) in enumerate(SAMPLE_ITEMS):
        on_hand = _balanced_stock(par, idx)
        existing = conn.execute(
            "SELECT id FROM items WHERE business_id = ? AND name = ?",
            (business_id, name),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE items SET aisle = ?, category = ?, on_hand = ?, par = ?, updated_at = ?
                WHERE id = ?
                """,
                (aisle, category, on_hand, par, now, existing["id"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO items (business_id, name, category, aisle, barcode, unit, on_hand, par, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (business_id, name, category, aisle, barcode, unit, on_hand, par, now, now),
            )


def seed_demo_store() -> None:
    init_db()
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM businesses WHERE store_code = ?", (DEMO_STORE_CODE,)
        ).fetchone()

        if row:
            if not row["pin_hash"]:
                conn.execute(
                    "UPDATE businesses SET pin_hash = ? WHERE id = ?",
                    (hash_pin(DEMO_PIN), row["id"]),
                )
            _upsert_items(conn, row["id"], utc_now())
            return

        existing = conn.execute("SELECT COUNT(*) AS c FROM businesses").fetchone()["c"]
        if existing:
            first = conn.execute("SELECT * FROM businesses ORDER BY id LIMIT 1").fetchone()
            if first and not first["store_code"]:
                conn.execute(
                    """
                    UPDATE businesses SET store_code = ?, pin_hash = ?
                    WHERE id = ?
                    """,
                    (DEMO_STORE_CODE, hash_pin(DEMO_PIN), first["id"]),
                )
                _upsert_items(conn, first["id"], utc_now())
            return

        now = utc_now()
        cur = conn.execute(
            """
            INSERT INTO businesses (name, type, currency, store_code, pin_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "Corner Stop Convenience",
                "convenience",
                "CAD",
                DEMO_STORE_CODE,
                hash_pin(DEMO_PIN),
                now,
            ),
        )
        _upsert_items(conn, cur.lastrowid, now)
