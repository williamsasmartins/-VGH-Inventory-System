import openpyxl, json

wb = openpyxl.load_workbook(r'C:\Users\Williams Martins\VGH Material\VGH_Pricing_Dryco_Updated.xlsx', data_only=True)

stores = {
    'Kenroc': 'List of Material Kenroc',
    'Pacific West': 'List of Material Pacific West',
    'Dryco': 'List of Material Dryco',
}

result = {}
for store_name, sheet_name in stores.items():
    ws = wb[sheet_name]
    prices = {}
    for row in ws.iter_rows(values_only=True):
        item, code, price = row[0], row[1], row[2]
        if code and price and price != 'Price' and price != '?':
            try:
                p = float(str(price))
                prices[str(code).strip()] = p
            except:
                pass
    result[store_name] = prices
    print(f'{store_name}: {len(prices)} prices')

# Generate SQL inserts
sql_lines = []
sql_lines.append("-- Stores")
sql_lines.append("INSERT INTO stores (name) VALUES ('Kenroc'), ('Pacific West'), ('Dryco') ON CONFLICT (name) DO NOTHING;")
sql_lines.append("")
sql_lines.append("-- Material prices")
sql_lines.append("INSERT INTO material_prices (material_code, store_name, price) VALUES")

rows = []
for store, prices in result.items():
    for code, price in prices.items():
        code_escaped = code.replace("'", "''")
        rows.append(f"  ('{code_escaped}', '{store}', {price})")

sql_lines.append(',\n'.join(rows))
sql_lines.append("ON CONFLICT (material_code, store_name) DO UPDATE SET price = EXCLUDED.price;")

with open(r'C:\Users\Williams Martins\VGH Material\prices_import.sql', 'w') as f:
    f.write('\n'.join(sql_lines))

print("\nSQL written to prices_import.sql")
print(f"Total prices: Kenroc={len(result['Kenroc'])}, PW={len(result['Pacific West'])}, Dryco={len(result['Dryco'])}")
