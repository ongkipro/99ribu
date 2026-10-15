#!/usr/bin/env python3
"""Check draft contract structure and synthetic schema scenarios, never live APIs.
Requires the already available PyYAML and jsonschema packages.
"""
from pathlib import Path
import copy
import json
import re
import yaml
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
spec = yaml.safe_load((ROOT / 'openapi.yaml').read_text())
checks = 0

def check(condition, label):
    global checks
    if not condition:
        raise AssertionError(label)
    checks += 1

def resolve(pointer):
    check(pointer.startswith('#/'), 'all schema references are local')
    value = spec
    for part in pointer[2:].split('/'):
        value = value[part.replace('~1', '/').replace('~0', '~')]
    return value

def walk(node):
    if isinstance(node, dict):
        if '$ref' in node:
            resolve(node['$ref'])
        for value in node.values():
            walk(value)
    elif isinstance(node, list):
        for item in node:
            walk(item)

walk(spec)
operation_ids = set()
operations = []
for path, methods in spec['paths'].items():
    for method, operation in methods.items():
        operations.append((path, method, operation))
        check(operation['operationId'] not in operation_ids, 'unique operationId')
        operation_ids.add(operation['operationId'])
        check(operation.get('x-contract-status') == 'proposal', 'new routes are explicitly proposed')
        check('security' in operation, 'security is explicit per operation')
        params = [resolve(x['$ref']) if '$ref' in x else x for x in operation.get('parameters', [])]
        check({x['name'] for x in params if x['in'] == 'path'} == set(re.findall(r'\{([^}]+)\}', path)), 'path parameters match template')
        if method == 'post':
            check(any(x['name'] == 'Idempotency-Key' and x.get('required') for x in params), 'POST requires stable retry key')
            check('requestBody' in operation, 'POST request body specified')
        if path.startswith('/admin/'):
            check(operation.get('x-allowed-roles'), 'admin role intent stated')
            check(all(x and not ({'cartAccess', 'orderAccess'} & set(x)) for x in operation['security']), 'guest capabilities cannot authorize admin')
        if path.startswith('/orders/{orderId}'):
            check(all('cartAccess' not in x for x in operation['security']), 'cart token cannot authorize order read/mutation')
        if path.startswith('/me/'):
            check(all(x and not ({'cartAccess', 'orderAccess'} & set(x)) for x in operation['security']), 'guest capability cannot authorize account history')
check(not any('withdraw' in x.lower() for x in spec['paths']), 'no manual affiliate withdrawal route')
check(all(not any(word in path for word in ('virgo', 'mengantar', '/webhooks')) for path in spec['paths']), 'unverified vendor/webhook contract is not fabricated')
check(all('localhost' in s['url'] for s in spec['servers']), 'no deployed API host claimed')

# Convert internal component refs to one JSON Schema document for example checks.
def remap(node):
    if isinstance(node, dict):
        return {k: (v.replace('#/components/schemas/', '#/$defs/') if k == '$ref' else remap(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [remap(v) for v in node]
    return node

def valid(name, instance, expected=True):
    schema = {'$ref': '#/$defs/' + name, '$defs': remap(spec['components']['schemas'])}
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    result = validator.is_valid(instance)
    check(result == expected, f'{name} synthetic example expected valid={expected}')

valid('CartLineInput', {'variant_id': 'synthetic-variant', 'quantity': 1})
valid('CartLineInput', {'variant_id': 'synthetic-variant', 'quantity': 0}, False)
valid('CartLineInput', {'variant_id': 'synthetic-variant', 'quantity': 1, 'price': 1}, False)
valid('CartLineUpdate', {'quantity': 1}, False)
valid('CartLineUpdate', {'quantity': 1, 'expected_version': 2})
valid('OrderCreate', {'quote_id': 'synthetic-quote', 'affiliate_id': 'forged'}, False)
valid('ReturnItemInput', {'order_item_id': 'synthetic-item', 'quantity': 1, 'reason': 'defective'}, False)
valid('ReturnItemInput', {'order_item_id': 'synthetic-item', 'delivered_fulfillment_item_id': 'synthetic-delivery', 'quantity': 1, 'reason': 'defective'})
valid('Money', -1, False)
valid('Money', 1.5, False)
valid('Money', 99000)
valid('PayoutReconcileInput', {'reason': 'Synthetic verification', 'status': 'succeeded'}, False)

option = {'id': 'synthetic-service', 'courier_name': 'Synthetic carrier', 'service_name': 'Synthetic service', 'shipping_amount': 10000, 'supports_cod': True}
package = {'id': 'synthetic-package', 'origin_city': 'Synthetic city', 'lines': [{'cart_line_id': 'synthetic-line', 'variant_id': 'synthetic-variant', 'quantity': 1}], 'options': [option], 'selected_option_id': 'synthetic-service', 'merchandise_amount': 99000, 'shipping_amount': 10000, 'subsidy_amount': 0, 'buyer_shipping_amount': 10000}
quote = {'id': 'synthetic-quote', 'cart_id': 'synthetic-cart', 'cart_version': 1, 'expires_at': '2030-01-01T00:00:00Z', 'payment_method': 'cod', 'packages': [package], 'merchandise_total': 99000, 'shipping_total': 10000, 'subsidy_total': 0, 'buyer_total': 109000, 'currency': 'IDR', 'available_payment_methods': [{'id': 'synthetic-cod', 'label': 'Synthetic COD', 'kind': 'cod', 'action_kind': 'none'}]}
valid('Quote', quote, False)  # COD collect amount cannot be absent.
quote['packages'][0]['cod_collect_amount'] = 109000
valid('Quote', quote)
empty_quote = copy.deepcopy(quote)
empty_quote['packages'] = []
valid('Quote', empty_quote, False)
# Owner-confirmed listing, finance and waybill amendments: draft schema regressions.
component = {'stock_item_id': 'synthetic-component', 'name': 'Synthetic item', 'quantity': 1}
valid('OfferContent', component)
valid('OfferContent', dict(component, price=99000), False)
variant = {'id': 'synthetic-variant', 'catalog_id': 'synthetic-catalog', 'sku': 'SYNTHETIC', 'label': 'Synthetic', 'attributes': [], 'price': 99000, 'currency': 'IDR', 'availability': 'available', 'image': {'url': 'https://example.com/synthetic.png', 'alt': 'Synthetic', 'width': 10, 'height': 10}, 'offer_kind': 'unit', 'contents': [component]}
valid('Variant', variant)
valid('Variant', dict(variant, price=198000), False)
valid('Variant', dict(variant, offer_kind='multipack'), False)
valid('Variant', dict(variant, offer_kind='multipack', contents=[dict(component, quantity=2)]))
valid('Variant', dict(variant, offer_kind='bundle'), False)
valid('Variant', dict(variant, offer_kind='bundle', contents=[component, dict(component, stock_item_id='synthetic-component-2')]))
balance = {'pending': 0, 'held': 0, 'eligible': 99000, 'allocated': 0, 'paid': 0, 'currency': 'IDR', 'minimum_payout': 99000, 'eligibility_automatic': True, 'transfer_mode': 'manual'}
valid('CommissionBalance', balance)
valid('CommissionBalance', dict(balance, minimum_payout=100000))  # Response may reflect an approved future owner configuration.
valid('CommissionBalance', dict(balance, minimum_payout=0), False)
valid('CommissionBalance', dict(balance, minimum_payout=-1), False)
check(spec['components']['schemas']['CommissionBalance']['properties']['minimum_payout']['default'] == 99000, 'initial payout threshold default is IDR99000')
check(spec['components']['schemas']['CommissionBalance']['properties']['minimum_payout']['readOnly'] is True, 'threshold response cannot grant client setting authority')
valid('CommissionBalance', dict(balance, transfer_mode='automatic'), False)
valid('ManualTransferVerificationInput', {'status': 'succeeded'}, False)
valid('ManualTransferVerificationInput', {'expected_version': 2, 'transfer_claim_id': 'synthetic-claim', 'bank_transfer_reference': 'synthetic-bank-reference', 'evidence_id': 'synthetic-evidence', 'transferred_at': '2030-01-01T00:00:00Z', 'reason': 'Synthetic verification', 'reauthentication_proof': 'synthetic-only'})
valid('PayoutEvidenceInput', {'file_name': 'synthetic.pdf', 'media_type': 'application/pdf', 'size_bytes': 10485761}, False)
check('stock_item_id' in spec['components']['schemas']['StockBalance']['required'], 'physical inventory belongs to component stock item')
check('waybill_issued_at' in spec['components']['schemas']['Fulfillment']['properties'], 'waybill issuance distinguished from buyer receipt')
check(spec['paths']['/admin/payouts/{payoutId}/manual-transfer-verifications']['post']['x-allowed-roles'] == ['owner', 'finance'], 'manual payment evidence restricted to finance')
# Financial controls: unknown HPP cannot become a complete zero-margin report.
cost = {'unit_cost': None, 'source': 'Awaiting supplier cost', 'reason': 'Initial setup', 'effective_from': '2030-01-01T00:00:00Z', 'expected_version': 0}
valid('ComponentCostVersionInput', cost)
valid('ComponentCostVersionInput', dict(cost, unit_cost=0))
valid('ComponentCostVersionInput', dict(cost, unit_cost=-1), False)
valid('ComponentCostVersionInput', dict(cost, unit_cost=1.5), False)
valid('ComponentCostVersionInput', dict(cost, profit=99000), False)
valid('ComponentCostVersionInput', {k:v for k,v in cost.items() if k != 'expected_version'}, False)
valid('FinancialMetric', {'amount': None, 'complete': False, 'missing_inputs': ['unit_cost']})
valid('FinancialMetric', {'amount': None, 'complete': True, 'missing_inputs': []}, False)
valid('FinancialMetric', {'amount': -5000, 'complete': True, 'missing_inputs': []})
valid('FinancialMetric', {'amount': 1000, 'complete': True, 'missing_inputs': ['provider_fee']}, False)
for path in ['/admin/finance/summary', '/admin/stock-items/{stockItemId}/cost-versions']:
    for method, operation in spec['paths'][path].items():
        check(operation['x-allowed-roles'] == ['owner', 'finance'], 'cost and finance restricted to owner/explicit finance grant')
        check(operation.get('x-required-permission', '').startswith('finance.'), 'finance permission named')
        response = operation['responses']['201' if method == 'post' else '200']
        check(response['headers']['Cache-Control']['schema']['const'] == 'no-store', 'sensitive finance response cannot be cached')
check('super_admin' not in json.dumps(spec), 'Super Admin UI label introduces no parallel canonical role')
check(spec['paths']['/admin/orders']['get']['x-required-permission'] == 'orders.history.read', 'history requires scoped read permission')
check(spec['components']['schemas']['AdminOrderHistory']['properties']['data']['maxItems'] == 100, 'admin history pages bounded')

finance_summary = spec['components']['schemas']['FinanceSummary']
for metric in ['net_merchandise_revenue', 'recognized_hpp', 'gross_merchandise_profit', 'operating_expenses', 'operating_result']:
    check(metric in finance_summary['required'], 'distinct accounting metric is required')
    check(finance_summary['properties'][metric]['$ref'].endswith('/FinancialMetric'), 'accounting metric retains unknown/completeness semantics')
check(finance_summary['properties']['hpp_basis']['enum'] == ['actual_lot_cost', 'estimated_snapshot', 'mixed', 'unknown'], 'recognized HPP source distinguished from estimates')
check(set(spec['paths']['/admin/finance/summary']) == {'get'}, 'derived finance result cannot be overwritten')

for path in ['/admin/orders', '/admin/orders/{orderId}']:
    check('warehouse' not in spec['paths'][path]['get']['x-allowed-roles'], 'warehouse role cannot disclose whole-order totals')
admin_filters = {p['name']: p for p in spec['paths']['/admin/orders']['get']['parameters'] if 'name' in p}
check(admin_filters['reference']['schema']['maxLength'] == 100, 'exact admin reference filter is bounded')
for query, component in [('payment_status', 'Order'), ('fulfillment_status', 'Fulfillment'), ('return_status', 'ReturnCase')]:
    property_name = 'payment_status' if component == 'Order' else 'status'
    check(admin_filters[query]['schema']['enum'] == spec['components']['schemas'][component]['properties'][property_name]['enum'], 'admin status filters use existing typed states')

# Native website chat schemas never conflate public messages with internal CS notes.
chat_input = {'client_message_id': 'synthetic-message-0001', 'text': 'Help with this product', 'attachment_ids': []}
valid('SupportMessageInput', chat_input)
valid('SupportMessageInput', dict(chat_input, text='', attachment_ids=['synthetic-image']))
valid('SupportMessageInput', dict(chat_input, text='   '), False)
valid('SupportMessageInput', dict(chat_input, text='x' * 4001), False)
valid('SupportMessageInput', dict(chat_input, attachment_ids=['a', 'b', 'c', 'd']), False)
valid('SupportMessageInput', dict(chat_input, sender='customer_service'), False)
valid('SupportConversationCreate', {'client_conversation_id': 'synthetic-conversation-0001'})
valid('SupportConversationCreate', {'client_conversation_id': 'synthetic-conversation-0001', 'order_number': 'GUESS'}, False)
image = {'id': 'synthetic-image', 'media_type': 'image/png', 'size_bytes': 1024, 'status': 'ready'}
valid('SupportAttachment', image)
valid('SupportAttachment', dict(image, media_type='image/svg+xml'), False)
valid('SupportAttachment', dict(image, size_bytes=5242881), False)
valid('SupportAttachment', dict(image, public_url='https://example.com/file.png'), False)
valid('SupportStatusInput', {'expected_version': 1, 'status': 'resolved', 'reason': 'Answered'})
valid('SupportStatusInput', {'expected_version': 1, 'status': 'paid', 'reason': 'Invalid effect'}, False)
valid('SupportAssignmentInput', {'expected_version': 1, 'assignee_user_id': None, 'reason': 'Release'})
valid('SupportReadInput', {'last_seen_sequence': -1}, False)
valid('SupportEvent', {'cursor': 'synthetic-cursor', 'kind': 'status', 'conversation_id': 'synthetic-chat', 'status': 'open'})
valid('SupportEvent', {'cursor': 'synthetic-cursor', 'kind': 'message', 'conversation_id': 'synthetic-chat'}, False)
valid('SupportEvent', {'cursor': 'synthetic-cursor', 'kind': 'internal_note', 'conversation_id': 'synthetic-chat'}, False)
valid('SupportEvent', {'cursor': 'synthetic-cursor', 'kind': 'status', 'conversation_id': 'synthetic-chat', 'status': 'open', 'note': 'private'}, False)
for path, methods in spec['paths'].items():
    if path.startswith('/admin/support/'):
        for method, operation in methods.items():
            check(operation['x-allowed-roles'] == ['owner', 'customer_service'], 'CS administration restricted to owner/CS')
    if path.startswith('/support/') or path.startswith('/admin/support/'):
        for method, operation in methods.items():
            check(operation['security'], 'chat requires verified session or scoped guest capability')
            check(next(v for k,v in operation['responses'].items() if k.startswith('2'))['headers']['Cache-Control']['schema']['const'] == 'no-store', 'private chat never cached')
            check(operation['x-primary-requirement'] == 'PR-22', 'native chat traceability')
check('notes' not in spec['components']['schemas']['SupportConversation']['properties'], 'buyer conversation excludes staff notes')
check('SupportInternalNote' not in json.dumps(spec['components']['schemas']['SupportMessage']), 'buyer message never embeds internal notes')
check('SupportInternalNote' not in json.dumps(spec['components']['schemas']['SupportEvent']), 'buyer stream never embeds internal notes')
check(set(spec['paths']['/support/conversations/{conversationId}/events']['get']['responses']['200']['content']) == {'text/event-stream', 'application/json'}, 'authenticated stream has bounded cursor fallback')

read_marker = {'conversation_id': 'synthetic-chat', 'last_seen_sequence': 1, 'updated_at': '2030-01-01T00:00:00Z', 'reader_side': 'customer'}
valid('SupportReadMarker', read_marker)
valid('SupportReadMarker', dict(read_marker, reader_side='staff'))
valid('SupportReadMarker', {k:v for k,v in read_marker.items() if k != 'reader_side'}, False)
valid('SupportReadMarker', dict(read_marker, reader_id='private-user'), False)
check('current_agent_last_read_sequence' in spec['components']['schemas']['SupportStaffConversation']['required'], 'staff own unread marker distinct from group read acknowledgement')

staff_stream = spec['paths']['/admin/support/conversations/{conversationId}/events']['get']
check(staff_stream['x-allowed-roles'] == ['owner', 'customer_service'], 'CS stream has explicit staff role boundary')
check(all('supportSession' not in scheme for scheme in staff_stream['security']), 'guest support cookie cannot authorize CS stream')
check(staff_stream['x-event-schema']['$ref'].endswith('/SupportEvent'), 'CS stream uses public message projection without notes')

# Expanded Markdown wire contracts: negative trust-boundary examples, never live handlers.
valid('SupportContextInput', {'kind': 'product', 'product_id': 'product-1', 'variant_id': 'variant-1'})
valid('SupportContextInput', {'kind': 'order', 'order_id': 'order-1'})
valid('SupportContextInput', {'kind': 'order', 'order_id': 'order-1', 'product_id': 'product-1'}, False)
valid('SupportContextInput', {'kind': 'product', 'order_id': 'order-1'}, False)
valid('SupportContextInput', {'kind': 'product', 'product_id': 'product-1', 'html': '<script>unsafe</script>'}, False)
valid('SupportMessageInput', dict(chat_input, reply_to_message_id='message-1', context={'kind': 'product', 'product_id': 'product-1'}))
valid('SupportMessageInput', dict(chat_input, text='', context={'kind': 'product', 'product_id': 'product-1'}), False)  # Card alone is not a nonblank public description.
valid('SupportReplyProjection', {'message_id': 'message-1', 'state': 'redacted', 'excerpt': ''})
valid('SupportReplyProjection', {'message_id': 'message-1', 'state': 'redacted', 'excerpt': 'retained secret'}, False)
valid('SupportReplyProjection', {'message_id': 'message-1', 'state': 'expired', 'excerpt': 'retained secret'}, False)
valid('SupportSearchInput', {'query': 'delivery', 'limit': 100})
valid('SupportSearchInput', {'query': 'x' * 201}, False)
valid('SupportSearchInput', {'query': 'delivery', 'limit': 101}, False)
valid('SupportSearchInput', {'query': 'delivery', 'customer_phone': 'synthetic'}, False)
valid('SupportPreferenceInput', {'expected_version': 0, 'archived': True, 'muted': True})
valid('SupportPreferenceInput', {'expected_version': 0, 'archived': True, 'muted': True, 'status': 'resolved'}, False)
valid('SupportPreferenceInput', {'expected_version': 0, 'archived': True, 'muted': True, 'participant_id': 'other'}, False)
valid('SupportReplyDraft', {'text': 'Draft', 'unresolved_placeholders': ['order_reference'], 'can_send': False})
valid('SupportReplyDraft', {'text': 'Draft', 'unresolved_placeholders': ['order_reference'], 'can_send': True}, False)
template_input = {'expected_version': 0, 'title': 'Delivery', 'text': 'Please check the delivery status.', 'placeholders': [], 'enabled': True, 'reason': 'Initial template'}
valid('SupportSavedReplyInput', template_input)
valid('SupportSavedReplyInput', dict(template_input, placeholders=['bank_account']), False)
valid('SupportSavedReplyInput', dict(template_input, text='   '), False)
valid('SupportClassificationInput', {'expected_version': 1, 'tag_ids': ['tag-1'], 'priority': 'normal', 'reason': 'Triage'})
valid('SupportClassificationInput', {'expected_version': 1, 'tag_ids': ['tag-1', 'tag-1'], 'priority': 'normal', 'reason': 'Triage'}, False)
valid('BuyerProfileInput', {'expected_version': 1, 'display_name': 'Ongki'})
valid('BuyerProfileInput', {'expected_version': 1, 'display_name': 'Ongki', 'email': 'new@example.com'}, False)
valid('BuyerProfileInput', {'expected_version': 1, 'display_name': 'Ongki', 'ktp': 'not-collected'}, False)
valid('BuyerProfile', {'id': 'buyer-1', 'display_name': 'Ongki', 'email': None, 'phone': None, 'email_verified': False, 'phone_verified': False, 'version': 1})
address_fields = {'recipient_name': 'Ongki', 'phone': '+6281200000000', 'address_line': 'Synthetic street 1', 'destination_id': 'area-1', 'postal_code': '12345', 'label': 'Home', 'province_id': 'province-1', 'city_id': 'city-1', 'district_id': 'district-1', 'subdistrict_id': 'subdistrict-1'}
valid('BuyerAddressFields', address_fields)  # RT/RW/landmark optional, no invented compulsory geography.
valid('BuyerAddressFields', dict(address_fields, rt='001', rw='002', landmark='Near the gate'))
valid('BuyerAddressFields', {k:v for k,v in address_fields.items() if k != 'destination_id'}, False)
valid('BuyerAddressFields', dict(address_fields, shipping_price=1), False)
valid('BuyerAddressInput', {'expected_version': 0, 'address': address_fields})
valid('BuyerAddressDefaultInput', {'expected_book_version': 1, 'address_id': None})
valid('BuyerAddressDefaultInput', {'expected_book_version': 1, 'address_id': 'address-1', 'owner_id': 'other'}, False)
valid('BuyerAddressDeleteInput', {'expected_version': 1, 'expected_book_version': 1, 'replacement_default_id': None})
valid('BuyerAddressDeleteInput', {'expected_version': 1}, False)
valid('VerifiedContactInput', {'kind': 'email', 'email': 'synthetic@example.com'})
valid('VerifiedContactInput', {'kind': 'phone', 'phone': '+6281200000000'})
valid('VerifiedContactInput', {'kind': 'phone', 'phone': '081200000000'}, False)
valid('VerifiedContactInput', {'kind': 'email', 'phone': '+6281200000000'}, False)
valid('VerifiedContactInput', {'kind': 'email', 'email': 'synthetic@example.com', 'phone': '+6281200000000'}, False)
contact_change = {'expected_version': 1, 'new_contact': {'kind': 'email', 'email': 'synthetic@example.com'}, 'reauthentication_proof': 'synthetic-proof-0001'}
valid('ContactChangeInput', contact_change)
valid('ContactChangeInput', {k:v for k,v in contact_change.items() if k != 'reauthentication_proof'}, False)
valid('ScopedChallengeVerifyInput', {'proof': 'synthetic-issued-proof'})
valid('ScopedChallengeVerifyInput', {'order_number': 'known-number'}, False)
valid('GuestOrderLinkInput', {'order_reference': 'known-number'}, False)
valid('GuestOrderLinkInput', {'order_reference': 'known-number', 'order_access_proof': 'synthetic-order-proof', 'reauthentication_proof': 'synthetic-account-proof'})
valid('SessionTerminationInput', {'scope': 'current'})
valid('SessionTerminationInput', {'scope': 'all_other'}, False)
valid('SessionTerminationInput', {'scope': 'all_other', 'reauthentication_proof': 'synthetic-action-proof'})
valid('NotificationStateInput', {'expected_version': 1, 'state': 'seen'})
valid('NotificationStateInput', {'expected_version': 1, 'state': 'seen', 'last_seen_sequence': 100}, False)
valid('NotificationStateInput', {'expected_version': 1, 'state': 'read'}, False)
notification = {'id': 'notification-1', 'kind': 'support_attention', 'target_kind': 'conversation', 'target_id': 'conversation-1', 'created_at': '2030-01-01T00:00:00Z', 'seen_at': None, 'dismissed_at': None, 'version': 1}
valid('PrivateNotification', notification)
valid('PrivateNotification', dict(notification, message_text='private'), False)
valid('PrivateNotification', dict(notification, internal_note_id='note-1'), False)
valid('ReceiptCollection', {'id': 'collection-1', 'shipment_id': 'shipment-1', 'status': 'unknown', 'merchandise_amount': 0, 'shipping_and_fees_amount': 0, 'occurred_at': None})
valid('ReceiptCollection', {'id': 'collection-1', 'shipment_id': 'shipment-1', 'status': 'verified', 'merchandise_amount': -1, 'shipping_and_fees_amount': 0, 'occurred_at': '2030-01-01T00:00:00Z'}, False)
valid('ReceiptNextAction', {'kind': 'check_original_payment', 'resource_id': 'attempt-1', 'enabled': True, 'reason': ''})
valid('ReceiptNextAction', {'kind': 'mark_paid', 'resource_id': 'attempt-1', 'enabled': True, 'reason': ''}, False)
valid('ReceiptNextAction', {'kind': 'retry_supported_payment', 'resource_id': 'attempt-1', 'enabled': True, 'reason': '', 'redirect_url': 'https://example.com/unsafe'}, False)
flags = {key: 'denied' for key in ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']}
choices = {key: 'denied' for key in ['analytics', 'advertising_measurement', 'marketing', 'meta', 'google', 'tiktok']}
choices['google_signals'] = flags
valid('ConsentReceiptInput', {'expected_version': 0, 'policy_version': 'synthetic-policy-v1', 'choices': choices})
valid('GoogleConsentChoices', dict(flags, ad_user_data='implicit'), False)
valid('GoogleConsentChoices', {k:v for k,v in flags.items() if k != 'ad_personalization'}, False)
funnel = {'client_event_id': 'synthetic-event-0001', 'name': 'checkout_started', 'occurred_at': '2030-01-01T00:00:00Z', 'consent_receipt_id': 'consent-1'}
valid('FunnelEventInput', funnel)
for forbidden_name in ['Purchase', 'purchase', 'payment_confirmed', 'cash_collected']:
    valid('FunnelEventInput', dict(funnel, name=forbidden_name), False)
valid('FunnelEventInput', dict(funnel, value=99000), False)
valid('FunnelEventInput', dict(funnel, paid=True), False)
valid('FunnelEventInput', dict(funnel, email='synthetic@example.com'), False)
ad_config = {'expected_version': 0, 'platform': 'google', 'external_destination_id': 'synthetic-public-account', 'conversion_action_id': 'synthetic-action', 'google_conversion_source': 'UPLOAD_CLICKS', 'enabled': False, 'server_purchase_enabled': True, 'browser_purchase_enabled': False, 'reason': 'Initial disabled configuration', 'reauthentication_proof': 'synthetic-owner-proof'}
valid('AdDestinationInput', ad_config)
valid('AdDestinationInput', dict(ad_config, browser_purchase_enabled=True), False)
valid('AdDestinationInput', dict(ad_config, google_conversion_source='WEBSITE'), False)
valid('AdDestinationInput', dict(ad_config, conversion_action_id=''), False)
valid('AdDestinationInput', dict(ad_config, access_token='never-http-config'), False)
valid('AdReplayInput', {'expected_version': 1, 'event_id': 'immutable-event-1', 'reason': 'Retry known-safe outbox event', 'reauthentication_proof': 'synthetic-owner-proof'})
valid('AdReplayInput', {'expected_version': 1, 'event_id': 'immutable-event-1', 'reason': 'Retry', 'reauthentication_proof': 'synthetic-owner-proof', 'new_value': 99000}, False)
dashboard_count = {'key': 'fulfillments_due', 'count': None, 'basis': 'snapshot', 'complete': False, 'queue_key': 'fulfillments', 'kind': 'count', 'amount': None, 'currency': None, 'financial_basis': 'not_applicable', 'definition': 'Authorized due fulfillment snapshot', 'as_of': '2030-01-01T00:00:00Z', 'queue_filter_token': 'synthetic-filter-0001', 'filter_version': 1, 'filter_expires_at': '2030-01-01T01:00:00Z'}
valid('DashboardMetric', dashboard_count)
valid('DashboardMetric', {'key': 'company_profit', 'count': 1000, 'basis': 'snapshot', 'complete': True, 'queue_key': 'fulfillments'}, False)
valid('WorkQueueItem', {'id': 'fulfillment-1', 'resource_kind': 'fulfillment', 'state': 'picking', 'due_at': None, 'warehouse_id': 'warehouse-1', 'version': 1})
valid('WorkQueueItem', {'id': 'fulfillment-1', 'resource_kind': 'fulfillment', 'state': 'picking', 'due_at': None, 'warehouse_id': 'warehouse-1', 'version': 1, 'whole_order_total': 198000}, False)
selection = {'mode': 'explicit_page', 'resource_ids': ['resource-1']}
valid('BoundedSelection', selection)
valid('BoundedSelection', {'mode': 'explicit_page', 'resource_ids': ['resource-1', 'resource-1']}, False)
valid('BoundedSelection', {'mode': 'explicit_page', 'resource_ids': [f'resource-{i}' for i in range(101)]}, False)
valid('BoundedSelection', dict(selection, filter_token='synthetic'), False)
valid('BoundedSelection', {'mode': 'filtered_snapshot', 'filter_token': 'synthetic', 'filter_version': 1})
valid('BoundedSelection', {'mode': 'filtered_snapshot', 'filter_token': 'synthetic'}, False)
valid('ExportInput', {'resource': 'fulfillments', 'selection': selection, 'column_set': 'warehouse_operations', 'reason': 'Warehouse work'})
valid('ExportInput', {'resource': 'fulfillments', 'selection': selection, 'column_set': 'all_customer_data', 'reason': 'Invalid export'}, False)
valid('ExportFilterInput', {'resource': 'fulfillments', 'warehouse_id': 'warehouse-1', 'from': '2030-01-01T00:00:00Z', 'to': '2030-02-01T00:00:00Z', 'statuses': ['ready'], 'max_rows': 1001}, False)
label_input = {'expected_shipment_version': 1, 'waybill_revision': 1, 'template_id': 'template-1', 'template_version': 1, 'format': 'thermal_100x150mm'}
valid('ShippingLabelGenerateInput', label_input)
valid('ShippingLabelGenerateInput', dict(label_input, format='A6_100x150'), False)
valid('ShippingLabelGenerateInput', dict(label_input, cod_amount=198000), False)
valid('ShippingLabelGenerateInput', dict(label_input, provider_url='https://example.com/secret'), False)
label_job = {'id': 'job-1', 'shipment_id': 'shipment-1', 'version': 1, 'waybill_revision': 1, 'template_id': 'template-1', 'template_version': 1, 'format': 'thermal_100x150mm', 'status': 'unknown', 'artifact_id': None, 'as_of': '2030-01-01T00:00:00Z'}
valid('ShippingLabelJob', label_job)
valid('ShippingLabelJob', dict(label_job, status='ready'), False)
valid('ShippingLabelJob', dict(label_job, status='ready', artifact_id='artifact-1'))
batch_item = {'shipment_id': 'shipment-1', 'expected_shipment_version': 1, 'waybill_revision': 1, 'template_id': 'template-1', 'template_version': 1}
valid('ShippingLabelBatchInput', {'items': [batch_item], 'format': 'a4_sheet', 'reason': 'Current page'})
valid('ShippingLabelBatchInput', {'items': [], 'format': 'a4_sheet', 'reason': 'Empty'}, False)
valid('ShippingLabelBatchInput', {'items': [batch_item] * 101, 'format': 'a4_sheet', 'reason': 'Too many'}, False)
print_input = {'artifact_id': 'artifact-1', 'expected_waybill_revision': 1, 'is_reprint': True, 'reason': 'Paper jam recovery', 'observation': 'unknown'}
valid('ShippingPrintAttemptInput', print_input)
valid('ShippingPrintAttemptInput', dict(print_input, observation='handed_over'), False)
valid('ShippingPrintAttemptInput', {k:v for k,v in print_input.items() if k != 'reason'}, False)
valid('ShippingPrintAttemptInput', dict(print_input, paid=True), False)
# Security-intent metadata is not runtime enforcement; handler tests remain mandatory.
for path in ['/me/profile', '/me/addresses', '/me/contact-change-challenges', '/me/guest-order-link-challenges']:
    for method, operation in spec['paths'][path].items():
        check(operation['security'] == [{'sessionCookie': []}, {'bearerAuth': []}], 'buyer maintenance cannot use order/support/visitor capability')
for path, methods in spec['paths'].items():
    if path.startswith('/admin/'):
        for method, operation in methods.items():
            check(all(not ({'visitorSession', 'supportSession', 'cartAccess', 'orderAccess'} & set(x)) for x in operation['security']), 'anonymous capability never authorizes administration')
    if path.startswith('/admin/advertising/'):
        for method, operation in methods.items():
            if method == 'post':
                check(operation['x-allowed-roles'] == ['owner'], 'advertising control writes remain owner-only')
for path, permission in [('/admin/exports', 'exports.download'), ('/admin/export-selections', 'exports.read'), ('/admin/label-artifacts/{artifactId}/content', 'shipping.labels.read'), ('/admin/shipments/{shipmentId}/print-attempts', 'shipping.labels.print')]:
    method = 'get' if path.endswith('/content') else 'post'
    check(spec['paths'][path][method]['x-required-permission'] == permission, 'exports/private labels have explicit separate permission')
check(spec['paths']['/admin/exports']['post']['responses']['200']['content'].keys() == {'text/csv'}, 'bounded export returns direct CSV, no invented asynchronous public download')
check(spec['paths']['/orders/{orderId}/receipt']['get']['security'] == [{'sessionCookie': []}, {'bearerAuth': []}, {'orderAccess': []}], 'receipt retains owned/verified guest boundary')
check(not any('purchase' in path.lower() for path in spec['paths']), 'no arbitrary browser Purchase ingestion route')
check(not any('simulat' in path.lower() or 'fixture' in path.lower() for path in spec['paths']), 'local simulation controls are not public commerce API')
for path in ['/admin/support/saved-replies', '/admin/support/tags']:
    check(spec['paths'][path]['post']['x-required-permission'] == 'support.tools.manage', 'ordinary CS cannot manage shared tools without supervisor grant')

dashboard_money = dict(dashboard_count, key='realized_contribution', kind='money', amount=-5000, currency='IDR', financial_basis='actual', complete=True, queue_key='reconciliation')
valid('DashboardMetric', dashboard_money)
valid('DashboardMetric', dict(dashboard_money, amount=None), False)
valid('DashboardMetric', dict(dashboard_money, amount=1.5), False)
valid('DashboardMetric', dict(dashboard_money, count=5), False)
valid('DashboardMetric', dict(dashboard_money, currency='USD'), False)
valid('DashboardMetric', dict(dashboard_money, financial_basis='unknown'), False)
valid('DashboardMetric', dict(dashboard_money, key='affiliate_liability'), False)  # Negative liability is not a contribution loss.
valid('DashboardMetric', dict(dashboard_money, complete=False, amount=None, financial_basis='unknown'))
valid('DashboardMetric', dict(dashboard_money, complete=False, amount=0), False)
valid('DashboardMetric', dict(dashboard_count, amount=99000), False)
valid('DashboardMetric', dict(dashboard_count, count=0, complete=True))
snapshot = {'workspace': 'finance', 'warehouse_ids': [], 'from': '2030-01-01T00:00:00Z', 'to': '2030-02-01T00:00:00Z', 'timezone': 'Asia/Jakarta', 'as_of': '2030-01-01T00:00:00Z', 'metrics': [dashboard_money]}
valid('DashboardSnapshot', snapshot)
for forbidden_workspace in ['warehouse', 'ecommerce_admin', 'customer_service']:
    valid('DashboardSnapshot', dict(snapshot, workspace=forbidden_workspace), False)
valid('DashboardSnapshot', dict(snapshot, workspace='warehouse', metrics=[dashboard_count]))

valid('FunnelEventInput', dict(funnel, name='address_validated'))
valid('BuyerAddressDeleteInput', {'expected_version': 1, 'replacement_default_id': None}, False)
valid('BuyerAddressDeleteInput', {'expected_version': 1, 'expected_book_version': 0, 'replacement_default_id': None}, False)
valid('ShippingLabelBatchInput', {'items': [batch_item, batch_item], 'format': 'a4_sheet', 'reason': 'Duplicate parcel'}, False)
check(any(p.get('name') == 'filter_token' for p in spec['paths']['/admin/work-queues']['get']['parameters']), 'role queue consumes scoped metric drilldown token')

valid('SupportConversationSearchInput', {'query': 'safe context', 'view': 'archived', 'limit': 20})
valid('SupportConversationSearchInput', {'query': 'safe context', 'customer_phone': 'not-enumerable'}, False)
valid('SupportContactBindingInput', {'expected_version': 0, 'contact': {'kind': 'email', 'email': 'synthetic@example.com'}})
valid('SupportContactBindingInput', {'expected_version': 1, 'contact': {'kind': 'email', 'email': 'synthetic@example.com'}}, False)
valid('SupportContactBindingInput', {'expected_version': 1, 'contact': {'kind': 'email', 'email': 'synthetic@example.com'}, 'reauthentication_proof': 'synthetic-original-identity-proof'})
check(spec['paths']['/support/conversation-searches']['post']['responses']['200']['content']['application/json']['schema']['$ref'].endswith('/SupportConversationList'), 'list metadata search returns no cross-thread body search payload')

# Receipt snapshots cannot depend on subsequently edited catalog/address-book data.
purchased_item = {'id': 'item-1', 'variant_id': 'variant-1', 'catalog_id': 'catalog-1', 'name': 'Original listing', 'variant_label': 'Original multipack', 'offer_kind': 'multipack', 'contents': [{'stock_item_id': 'component-1', 'name': 'Original component', 'quantity': 2}], 'quantity': 1, 'unit_price': 99000, 'subtotal': 99000, 'returned_quantity': 0}
valid('OrderItem', purchased_item)
valid('OrderItem', {k:v for k,v in purchased_item.items() if k != 'contents'}, False)
valid('OrderItem', dict(purchased_item, unit_price=198000), False)
valid('OrderItem', dict(purchased_item, offer_kind='unit'), False)
valid('OrderItem', dict(purchased_item, contents=[{'stock_item_id': 'component-1', 'name': 'Original component', 'quantity': 1}]), False)
valid('OrderItem', dict(purchased_item, contents=[{'stock_item_id': 'component-1', 'name': 'Original component', 'quantity': 2, 'price': 99000}]), False)
ship_to = {'recipient_name': 'Synthetic Recipient', 'phone_masked': '+62••••0000', 'address_line': 'Original synthetic street 1', 'destination_id': 'destination-1', 'province': 'Synthetic province', 'city': 'Synthetic city', 'district': 'Synthetic district', 'subdistrict': 'Synthetic subdistrict', 'postal_code': '12345', 'snapshot_at': '2030-01-01T00:00:00Z'}
valid('ReceiptShipToSnapshot', ship_to)
valid('ReceiptShipToSnapshot', dict(ship_to, rt='001', rw='002', landmark='Original gate'))
valid('ReceiptShipToSnapshot', dict(ship_to, phone='+6281200000000'), False)
valid('ReceiptShipToSnapshot', dict(ship_to, email='synthetic@example.com'), False)
valid('ReceiptShipToSnapshot', dict(ship_to, address_book_id='mutable-address-1'), False)
valid('ReceiptShipToSnapshot', dict(ship_to, order_access_token='secret-not-returned'), False)
receipt_order = {'id': 'order-1', 'number': 'SYNTHETIC-1', 'status': 'pending', 'payment_status': 'pending', 'payment_method': 'prepaid', 'currency': 'IDR', 'items': [purchased_item], 'shipments': [], 'merchandise_total': 99000, 'shipping_total': 10000, 'subsidy_total': 0, 'buyer_total': 109000, 'created_at': '2030-01-01T00:00:00Z', 'version': 1}
receipt = {'order': receipt_order, 'as_of': '2030-01-01T00:00:00Z', 'version': 1, 'money_basis': 'frozen_order_totals_and_verified_allocations', 'collections': [], 'refunds': [], 'next_actions': [], 'last_checked_at': '2030-01-01T00:00:00Z', 'payment_state': 'unknown', 'payment_attempt_id': 'attempt-1', 'collections_complete': True, 'refunds_complete': True, 'ship_to': ship_to}
valid('OrderReceipt', receipt)
valid('OrderReceipt', {k:v for k,v in receipt.items() if k != 'ship_to'}, False)
check(spec['components']['schemas']['OrderItem']['properties']['contents']['readOnly'] is True, 'purchased contents are immutable response snapshots')
check('ship_to' not in spec['components']['schemas']['Order']['properties'], 'private receipt address is not added to general staff/buyer Order projection')
check(spec['components']['schemas']['ReceiptShipToSnapshot']['readOnly'] is True, 'receipt address snapshot is not a mutable address-book input')

valid('ReceiptShipToSnapshot', dict(ship_to, phone_masked='+6281200000000'), False)

# Explicit catalog draft changes preserve stable identities and never charge components.
new_offer = {'sku': 'SYNTHETIC-NEW', 'label': 'Two-piece offer', 'attributes': [], 'weight_grams': 100, 'length_mm': 10, 'width_mm': 10, 'height_mm': 10, 'default_warehouse_id': 'warehouse-1', 'offer_kind': 'multipack', 'contents': [{'stock_item_id': 'component-1', 'name': 'Component', 'quantity': 2}]}
offer_update = {k:v for k,v in new_offer.items() if k != 'sku'}
valid('OfferDraftInput', new_offer)
valid('OfferUpdateInput', offer_update)
valid('OfferUpdateInput', dict(offer_update, sku='REASSIGNED'), False)
valid('OfferUpdateInput', dict(offer_update, catalog_id='REUSED-ID'), False)
valid('OfferUpdateInput', dict(offer_update, price=198000), False)
valid('OfferUpdateInput', dict(offer_update, on_hand=100), False)
valid('OfferUpdateInput', dict(offer_update, offer_kind='unit'), False)
valid('OfferUpdateInput', dict(offer_update, weight_grams=0), False)
valid('OfferDraftChange', {'operation': 'create', 'create': new_offer})
valid('OfferDraftChange', {'operation': 'update', 'variant_id': 'variant-1', 'update': offer_update})
valid('OfferDraftChange', {'operation': 'retire', 'variant_id': 'variant-1'})
valid('OfferDraftChange', {'operation': 'delete', 'variant_id': 'variant-1'}, False)
valid('OfferDraftChange', {'operation': 'create', 'variant_id': 'reused-id', 'create': new_offer}, False)
valid('OfferDraftChange', {'operation': 'update', 'update': offer_update}, False)
valid('OfferDraftChange', {'operation': 'retire', 'variant_id': 'variant-1', 'update': offer_update}, False)
product_edit = {'reason': 'Correct future offer contents', 'expected_version': 1, 'variant_changes': [{'operation': 'update', 'variant_id': 'variant-1', 'update': offer_update}]}
valid('ProductPatch', product_edit)
valid('ProductPatch', dict(product_edit, expected_version=0), False)
valid('ProductPatch', {'reason': 'No edit', 'expected_version': 1}, False)
valid('ProductPatch', dict(product_edit, variant_changes=[]), False)
valid('ProductPatch', dict(product_edit, variant_changes=[{'operation': 'retire', 'variant_id': 'variant-1'}] * 2), False)
check(any(p.get('$ref') == '#/components/parameters/IdempotencyKey' for p in spec['paths']['/admin/products/{productId}']['patch']['parameters']), 'new offer edits have durable retry identity in addition to optimistic version')
check(spec['paths']['/admin/products/{productId}']['get']['x-allowed-roles'] == ['owner', 'ecommerce_admin'], 'private draft recovery restricted to catalog roles')
check('version' in spec['components']['schemas']['Product']['required'], 'catalog draft version is discoverable for optimistic edit/publication')

# Arithmetic, actual authorization and idempotent side effects need later domain/runtime tests.
print(f'PASS planning contract: {len(spec["paths"])} paths, {len(operations)} operations, {len(spec["components"]["schemas"])} schemas; {checks} structural/schema assertions. No endpoint or provider executed.')
