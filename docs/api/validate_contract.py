"""Validate OpenAPI structure, component schemas, fixtures and contract invariants.

Requires openapi-spec-validator (which supplies jsonschema transitively).
No network calls and no running API required.
"""
import argparse
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--dependency-path')
args = parser.parse_args()
if args.dependency_path:
    sys.path.insert(0, args.dependency_path)
try:
    from jsonschema import Draft202012Validator, FormatChecker
    from openapi_spec_validator import validate_spec
except ImportError:
    raise SystemExit('Install openapi-spec-validator==0.7.2 in your validation environment first.')

root = Path(__file__).resolve().parent
spec = json.loads((root/'openapi.json').read_text(encoding='utf-8'))
validate_spec(spec)
schemas = spec['components']['schemas']
for name, schema in schemas.items():
    Draft202012Validator.check_schema(schema)


def validator(name):
    return Draft202012Validator({'$ref': '#/components/schemas/'+name, 'components': spec['components']}, format_checker=FormatChecker())


def walk(value):
    if isinstance(value, dict):
        if '$ref' in value:
            target = spec
            assert value['$ref'].startswith('#/'), 'External ref requires deliberate offline validation support'
            for part in value['$ref'][2:].split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        for child in value.values():
            walk(child)
    elif isinstance(value, list):
        for child in value:
            walk(child)


walk(spec)
manifest = json.loads((root/'examples'/'manifest.json').read_text(encoding='utf-8'))
examples = {}
for file, meta in manifest.items():
    value = json.loads((root/'examples'/file).read_text(encoding='utf-8'))
    validator(meta['schema']).validate(value)
    examples[file] = value
for name, schema in schemas.items():
    for example in schema.get('examples', []):
        validator(name).validate(example)

operation_ids = set()
for path, methods in spec['paths'].items():
    for method, op in methods.items():
        assert op['operationId'] not in operation_ids, 'Duplicate operation ID'
        operation_ids.add(op['operationId'])
        assert op['x-roles'], 'Missing role contract'
        names = {(p['in'], p['name']) for p in op['parameters']}
        assert len(names) == len(op['parameters']), 'Duplicate parameter'
        for variable in re.findall(r'\{([^}]+)\}', path):
            assert ('path', variable) in names, 'Missing path parameter'
        if method in ('post', 'patch'):
            assert ('header', 'X-CSRF-Token') in names
            if not path.startswith('/auth/'):
                assert ('header', 'Idempotency-Key') in names
        if method == 'patch':
            assert ('header', 'If-Match') in names
        if not path.startswith('/auth/'):
            assert op['security'] == [{'sessionCookie': []}]

# Ensure common integration mistakes are rejected structurally.
negative = [
    ('PaymentInput', {'amount': 680, 'method': 'bank_transfer', 'payment_date': '2026-10-31'}),
    ('PaymentInput', {'amount': '680.000', 'method': 'bank_transfer', 'payment_date': '2026-10-31'}),
    ('PaymentInput', {'amount': '680.00', 'method': 'bank_transfer', 'payment_date': 'not-a-date'}),
    ('RegisterInput', {'email': 'x@example.com', 'password': 'ValidPassword!', 'display_name': 'X', 'role': 'admin'}),
    ('RegisterInput', {'email': 'x@example.com', 'password': 'weak', 'display_name': 'X'}),
    ('SubscriptionInput', {**examples['subscription-create.json'], 'status': 'active'}),
    ('AddonInput', {'product_id': 'bad-id', 'variant_id': None, 'quantity': '1.0000', 'enabled': True}),
    ('AddonInput', {'product_id': '00000000-0000-4000-8000-000000000020', 'variant_id': None, 'quantity': '1.0000', 'enabled': True, 'unit_price': '0.0000'}),
]
for name, value in negative:
    assert not validator(name).is_valid(value), f'Unexpected acceptance: {name} {value}'

invoice = examples['invoice-partial.json']['data']
assert Decimal(invoice['subtotal']) - Decimal(invoice['discount_total']) + Decimal(invoice['tax_total']) == Decimal(invoice['total'])
assert Decimal(invoice['total']) - Decimal(invoice['amount_paid']) == Decimal(invoice['balance_due'])
paid = examples['payment-result.json']['data']
assert Decimal(invoice['amount_paid']) + Decimal(paid['payment']['amount']) == Decimal(paid['invoice']['amount_paid'])
assert paid['invoice']['status'] == 'paid' and Decimal(paid['invoice']['balance_due']) == 0
overview = examples['overview.json']['data']
assert sum(Decimal(row['invoiced_total']) for row in overview['monthly']) == Decimal(overview['invoiced_total'])
assert sum(Decimal(row['payments_received']) for row in overview['monthly']) == Decimal(overview['payments_received'])
assert Decimal(overview['invoiced_total']) - Decimal(overview['payments_received']) == Decimal(overview['outstanding_balance'])
print(f'PASS: {len(operation_ids)} operations, {len(schemas)} schemas, {len(examples)} examples, {len(negative)} invalid-payload cases, references, permission/header declarations and fixture arithmetic.')
