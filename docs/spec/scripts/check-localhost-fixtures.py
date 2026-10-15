#!/usr/bin/env python3
"""Validate synthetic seed arithmetic and isolation intent, never an app or provider."""
import copy
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def indexed(rows, label):
    result = {r['id']: r for r in rows}
    require(len(result) == len(rows), f'{label}: duplicate identity')
    return result


def validate(data):
    require(data['synthetic'] is True and data['environment'] == 'local', 'local synthetic scope required')
    require(data['real_external_effects'] is False, 'external effects forbidden')
    require(data['currency'] == 'IDR', 'IDR expected')
    def money_types(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key.endswith('_idr'):
                    require((key == 'hpp_idr' and item is None) or (type(item) is int and item >= 0), f'invalid integer IDR: {key}')
                money_types(item)
        elif isinstance(value, list):
            for item in value:
                money_types(item)
    money_types(data)
    users = indexed(data['users'], 'users')
    roles = {role for user in users.values() for role in user['roles']}
    require(roles == {'owner', 'ecommerce_admin', 'warehouse', 'customer_service', 'finance', 'buyer', 'affiliate'}, 'all roles represented')
    warehouses = indexed(data['warehouses'], 'warehouses')
    for user in users.values():
        require(user['email'].endswith('@example.test'), 'non-test contact')
        require(set(user.get('warehouse_ids', [])) <= warehouses.keys(), 'unknown user warehouse')
    stock = indexed(data['stock_items'], 'stock')
    offers = indexed(data['offers'], 'offers')
    for offer in offers.values():
        require(offer['price_idr'] == 99000, 'offer price must be99000')
        require(bool(offer['components']), 'empty offer')
        require(len({c['stock_item_id'] for c in offer['components']}) == len(offer['components']), 'duplicate component')
        for component in offer['components']:
            require(component['stock_item_id'] in stock and type(component['quantity']) is int and component['quantity'] > 0, 'bad component')
    balances = {}
    for row in data['inventory']:
        key = (row['warehouse_id'], row['stock_item_id'])
        require(key not in balances and key[0] in warehouses and key[1] in stock, 'invalid inventory key')
        require(all(type(row[k]) is int and row[k] >= 0 for k in ('on_hand', 'reserved', 'quarantine')), 'bad inventory quantity')
        require(row['on_hand'] >= row['reserved'] + row['quarantine'], 'negative available inventory')
        balances[key] = row
    orders = indexed(data['orders'], 'orders')
    all_lines, receipts = {}, {}
    for order in orders.values():
        require(order['buyer_id'] in users and 'buyer' in users[order['buyer_id']]['roles'], 'order buyer missing')
        lines = indexed(order['items'], 'order items')
        for line in lines.values():
            require(line['id'] not in all_lines and line['offer_id'] in offers, 'bad global order line')
            require(type(line['quantity']) is int and line['quantity'] > 0, 'bad line quantity')
            all_lines[line['id']] = (order, line)
        merchandise = sum(offers[line['offer_id']]['price_idr'] * line['quantity'] for line in lines.values())
        require(merchandise == order['merchandise_idr'], 'merchandise double-charge')
        require(0 <= order['shipping_subsidy_idr'] <= order['shipping_idr'], 'invalid shipping subsidy')
        require(order['buyer_total_idr'] == merchandise + order['shipping_idr'] - order['shipping_subsidy_idr'], 'buyer total mismatch')
        require(0 <= order['refund_idr'] <= order['verified_paid_idr'] <= order['buyer_total_idr'], 'money bound')
        covered = []
        for parcel in order['parcels']:
            require(parcel['warehouse_id'] in warehouses, 'parcel warehouse missing')
            require(parcel['awb'].startswith('TEST-NOT-FOR-SHIPPING-'), 'real-looking AWB forbidden')
            require(bool(parcel['item_ids']) and set(parcel['item_ids']) <= lines.keys(), 'parcel item missing')
            covered += parcel['item_ids']
            # Historical order snapshots reference stock; this does not prove a current reservation.
            for item_id in parcel['item_ids']:
                for component in offers[lines[item_id]['offer_id']]['components']:
                    row = balances.get((parcel['warehouse_id'], component['stock_item_id']))
                    require(row is not None and row['on_hand'] >= component['quantity'] * lines[item_id]['quantity'], 'incomplete single-warehouse offer')
            if 'verified_collection_id' in parcel:
                reference = parcel['verified_collection_id']
                require(reference not in receipts and 0 < parcel['collected_idr'] <= parcel['cod_due_idr'], 'invalid collection')
                require(0 < parcel['collected_merchandise_idr'] <= parcel['collected_idr'], 'collection merchandise coverage')
                receipts[reference] = (order['id'], set(parcel['item_ids']), parcel['collected_merchandise_idr'])
        require(len(covered) == len(set(covered)) and set(covered) == lines.keys(), 'parcel line overlap/loss')
        if order['method'] == 'cod':
            require(sum(p['cod_due_idr'] for p in order['parcels']) == order['buyer_total_idr'], 'COD due conservation')
            require(sum(p.get('collected_idr', 0) for p in order['parcels']) == order['verified_paid_idr'], 'COD collection conservation')
        else:
            require(all(p['cod_due_idr'] == 0 for p in order['parcels']), 'prepaid COD due')
            reference = order['verified_payment_id']
            require(reference not in receipts, 'duplicate payment reference')
            require(order['verified_merchandise_idr'] <= min(order['merchandise_idr'], order['verified_paid_idr']), 'prepaid merchandise coverage')
            receipts[reference] = (order['id'], set(lines), order['verified_merchandise_idr'])
    purchases = indexed(data['purchase_events'], 'purchases')
    used_receipts, allocated = set(), defaultdict(int)
    for event in purchases.values():
        receipt = event['economic_receipt_id']
        require(receipt in receipts and receipt not in used_receipts, 'duplicate/unverified economic receipt')
        used_receipts.add(receipt)
        order_id, permitted_lines, merchandise_coverage = receipts[receipt]
        require(0 < event['merchandise_value_idr'] <= merchandise_coverage, 'Purchase exceeds verified merchandise coverage')
        require(event['order_id'] == order_id, 'cross-order receipt')
        require(sum(a['merchandise_value_idr'] for a in event['allocations']) == event['merchandise_value_idr'], 'purchase value mismatch')
        for allocation in event['allocations']:
            item_id = allocation['order_item_id']
            require(item_id in permitted_lines, 'cross-parcel allocation')
            _, line = all_lines[item_id]
            quantity = allocation['quantity']
            require(type(quantity) is int and quantity > 0, 'bad purchase quantity')
            allocated[item_id] += quantity
            require(allocated[item_id] <= line['quantity'], 'duplicate purchased quantity')
            require(allocation['merchandise_value_idr'] == quantity * offers[line['offer_id']]['price_idr'], 'shipping/components in ad value')
    refunded = defaultdict(int)
    for adjustment in data['refund_adjustments']:
        event = purchases[adjustment['purchase_event_id']]
        value = event['merchandise_value_idr']
        refunded[event['order_id']] += adjustment['refunded_merchandise_idr']
        require(0 <= adjustment['refunded_merchandise_idr'] <= value, 'invalid refund')
        require(adjustment['retained_value_idr'] == value - adjustment['refunded_merchandise_idr'], 'refund retained value')
    for order_id, amount in refunded.items():
        require(amount <= orders[order_id]['refund_idr'], 'refund exceeds verified refund')
    for transaction in data['finance_transactions']:
        rows = transaction['postings']
        require(bool(rows), 'empty finance transaction')
        require(all(type(r[k]) is int and r[k] >= 0 for r in rows for k in ('debit_idr', 'credit_idr')), 'bad posting')
        require(sum(r['debit_idr'] for r in rows) == sum(r['credit_idr'] for r in rows), 'unbalanced transaction')
    cases = [s['case'] for s in data['simulations']]
    require(len(cases) == len(set(cases)) and len(cases) >= 14, 'simulation coverage/identity')


def mutation_probes(data):
    """Deliberate bad data must fail the arithmetic/scope contract."""
    def price(d): d['offers'][0]['price_idr'] = 100000
    def stock(d): d['inventory'][0]['reserved'] = 999
    def cod(d): d['orders'][1]['parcels'][1]['cod_due_idr'] += 1
    def receipt(d): d['purchase_events'][1]['economic_receipt_id'] = d['purchase_events'][0]['economic_receipt_id']
    def value(d): d['purchase_events'][0]['merchandise_value_idr'] += 12000
    def refund(d): d['refund_adjustments'][0]['retained_value_idr'] = 198000
    def ledger(d): d['finance_transactions'][0]['postings'][0]['debit_idr'] += 1
    def cross_parcel(d): d['purchase_events'][1]['allocations'][0]['order_item_id'] = 'fixture-cod-line-b'
    def external(d): d['real_external_effects'] = True
    def tiny_collection(d):
        d['orders'][1]['parcels'][0]['collected_idr'] = 1
        d['orders'][1]['verified_paid_idr'] = 1
    def bad_hpp(d): d['stock_items'][0]['hpp_idr'] = -0.5
    def float_price(d): d['offers'][0]['price_idr'] = 99000.0
    probes = (price, stock, cod, receipt, value, refund, ledger, cross_parcel, external, tiny_collection, bad_hpp, float_price)
    for mutate in probes:
        broken = copy.deepcopy(data)
        mutate(broken)
        try:
            validate(broken)
        except ValueError:
            continue
        raise AssertionError(f'Invalid fixture accepted: {mutate.__name__}')
    return len(probes)


if __name__ == '__main__':
    fixture = json.loads((ROOT / 'fixtures/localhost-commerce.json').read_text())
    validate(fixture)
    probes = mutation_probes(fixture)
    print(f"PASS synthetic fixture: {len(fixture['users'])} users, {len(fixture['offers'])} offers, {len(fixture['orders'])} orders, {len(fixture['simulations'])} scenario contracts; {probes} invalid mutations rejected. No app/DB/provider executed.")
