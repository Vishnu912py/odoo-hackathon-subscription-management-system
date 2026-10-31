"""Build the checked-in API contract and examples using only Python's standard library.

This generates documentation, not an API server or database migrations.
Run: python docs/api/build_contract.py
"""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMAS = {}
PATHS = {}


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def text(**kw):
    return {"type": "string", **kw}


def enum(*values):
    return {"type": "string", "enum": list(values)}


def integer(minimum=0, **kw):
    return {"type": "integer", "minimum": minimum, **kw}


def nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


def array(schema, **kw):
    return {"type": "array", "items": schema, **kw}


def obj(properties, required=None, **kw):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required,
            "additionalProperties": False, **kw}


def define(name, properties, required=None, **kw):
    SCHEMAS[name] = obj(properties, required, **kw)
    return ref(name)


ID = text(format="uuid")
DATE = text(format="date")
TIME = text(format="date-time")
BOOL = {"type": "boolean"}
NAME = text(minLength=1, maxLength=200)
NOTE = text(maxLength=2000)
EMAIL = text(format="email", maxLength=254)
MONEY = text(pattern=r"^(0|[1-9][0-9]{0,15})\.[0-9]{2}$", description="Nonnegative decimal string, exactly two fractional digits; INR in v1.")
DECIMAL = text(pattern=r"^(0|[1-9][0-9]{0,13})\.[0-9]{4}$", description="Nonnegative decimal string with four fractional digits; quantity must be > 0.")
SIGNED = text(pattern=r"^-?(0|[1-9][0-9]{0,13})\.[0-9]{4}$")
RATE = text(pattern=r"^(0|[1-9][0-9]{0,2})\.[0-9]{4}$", description="Percentage from 0 through 100 inclusive; range checked by server.")
ROLE = enum("admin", "staff", "customer")
INTERVAL = enum("daily", "weekly", "monthly", "yearly")
SUB_STATUS = enum("draft", "quotation", "confirmed", "active", "closed")
INV_STATUS = enum("draft", "confirmed", "paid", "cancelled")
BASE = {"id": ID, "version": integer(1), "created_at": TIME, "updated_at": TIME}
PASSWORD = text(minLength=9, maxLength=128, pattern=r"^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,128}$", writeOnly=True)

define("Error", {"error": obj({"code": NAME, "message": NAME,
    "fields": array(obj({"path": text(), "code": NAME, "message": NAME})),
    "request_id": ID})})
define("PageMeta", {"page": integer(1), "page_size": integer(1, maximum=100), "total": integer(), "total_pages": integer()})
define("Message", {"message": NAME})
define("Csrf", {"csrf_token": text(minLength=32)})
define("User", {"id": ID, "email": EMAIL, "display_name": NAME, "role": ROLE, "customer_id": nullable(ID), "is_active": BOOL})
define("Session", {"user": ref("User"), "csrf_token": text(minLength=32), "expires_at": TIME})
define("LoginInput", {"email": EMAIL, "password": text(minLength=1, maxLength=128, writeOnly=True)})
define("RegisterInput", {"email": EMAIL, "password": PASSWORD, "display_name": NAME, "company_name": nullable(NAME)}, ["email", "password", "display_name"])
define("ForgotPasswordInput", {"email": EMAIL})
define("ResetPasswordInput", {"token": text(minLength=32, writeOnly=True), "password": PASSWORD})
define("StaffInput", {"email": EMAIL, "display_name": NAME})
define("StaffUpdate", {"display_name": NAME, "is_active": BOOL}, [], minProperties=1)
define("Staff", {**BASE, "email": EMAIL, "display_name": NAME, "role": enum("staff"), "is_active": BOOL, "invitation_status": enum("pending", "accepted")})

customer_fields = {"name": NAME, "company_name": nullable(NAME), "billing_email": EMAIL, "billing_address": nullable(NOTE)}
define("CustomerInput", customer_fields, ["name", "billing_email"])
define("CustomerUpdate", customer_fields, [], minProperties=1)
define("Customer", {**BASE, **customer_fields, "user_id": nullable(ID)})
variant_fields = {"name": NAME, "attributes": {"type": "object", "additionalProperties": text(), "maxProperties": 10}, "price_adjustment": SIGNED, "is_active": BOOL}
define("VariantInput", variant_fields, ["name", "attributes", "price_adjustment"])
define("VariantUpdate", variant_fields, [], minProperties=1)
define("Variant", {**BASE, "product_id": ID, **variant_fields})
product_fields = {"name": NAME, "product_type": enum("service", "goods"), "sales_price": DECIMAL, "cost_price": DECIMAL, "notes": nullable(NOTE), "tax_ids": array(ID, uniqueItems=True), "is_active": BOOL}
define("ProductInput", product_fields, ["name", "product_type", "sales_price", "cost_price", "tax_ids"])
define("ProductUpdate", product_fields, [], minProperties=1)
define("Product", {**BASE, **product_fields, "variants": array(ref("Variant"))}, list(BASE)+[k for k in product_fields if k != "cost_price"]+["variants"], description="cost_price is present for admin only and omitted for staff. Customers cannot use this endpoint.")
plan_line_fields = {"product_id": ID, "default_quantity": DECIMAL, "is_addon": BOOL, "unit_price_override": nullable(DECIMAL)}
define("PlanProductInput", plan_line_fields)
define("PlanProduct", {"id": ID, **plan_line_fields})
plan_fields = {"name": NAME, "price": MONEY, "currency": enum("INR"), "billing_interval": INTERVAL,
    "minimum_quantity": DECIMAL, "available_from": nullable(DATE), "available_until": nullable(DATE),
    "auto_close": BOOL, "allow_early_close": BOOL, "allow_pause": BOOL, "allow_renewal": BOOL,
    "is_active": BOOL, "products": array(ref("PlanProductInput"), minItems=1)}
define("PlanInput", plan_fields)
define("PlanUpdate", plan_fields, [], minProperties=1)
define("Plan", {**BASE, **plan_fields, "products": array(ref("PlanProduct"), minItems=1)})
tax_fields = {"name": NAME, "rate_percent": RATE, "is_active": BOOL}
define("TaxInput", tax_fields)
define("TaxUpdate", {"name": NAME, "is_active": BOOL}, [], minProperties=1)
define("Tax", {**BASE, **tax_fields}, description="Rates immutable after creation. Create a new rule ID to change a rate; existing agreements retain their assigned tax rule.")
term_fields = {"name": NAME, "due_days": integer(0, maximum=365), "is_active": BOOL}
define("PaymentTermInput", term_fields)
define("PaymentTermUpdate", {"name": NAME, "is_active": BOOL}, [], minProperties=1)
define("PaymentTerm", {**BASE, **term_fields})
template_line = {"product_id": ID, "variant_id": nullable(ID), "quantity": DECIMAL, "unit_price": DECIMAL}
define("TemplateLineInput", template_line, description="unit_price is final, including any variant adjustment. Copy unchanged when seeding a quotation.")
template_fields = {"name": NAME, "plan_id": ID, "validity_days": integer(1, maximum=365), "is_active": BOOL, "lines": array(ref("TemplateLineInput"), minItems=1)}
define("TemplateInput", template_fields)
define("TemplateUpdate", template_fields, [], minProperties=1)
define("Template", {**BASE, **template_fields})
discount_fields = {"name": NAME, "discount_type": enum("fixed", "percentage"), "value": DECIMAL,
    "currency": nullable(enum("INR")), "scope": enum("product", "subscription"),
    "product_ids": array(ID, uniqueItems=True), "subscription_ids": array(ID, uniqueItems=True),
    "minimum_purchase": nullable(MONEY), "minimum_quantity": nullable(DECIMAL),
    "valid_from": DATE, "valid_until": nullable(DATE), "usage_limit": nullable(integer(1)), "is_active": BOOL}
define("DiscountInput", discount_fields, description="Fixed rules require INR currency; percentage rules require null currency and value <=100. Product scope requires product_ids and empty subscription_ids; subscription scope requires the reverse.")
define("DiscountUpdate", {"name": NAME, "is_active": BOOL}, [], minProperties=1)
define("Discount", {**BASE, **discount_fields, "usage_count": integer()})

line_input = {"product_id": ID, "variant_id": nullable(ID), "quantity": DECIMAL, "unit_price": DECIMAL, "tax_ids": array(ID, uniqueItems=True)}
define("SubscriptionLineInput", line_input, ["product_id", "variant_id", "quantity"], description="Explicit lines with omitted unit_price use plan override/product price plus variant adjustment. Omitted lines copy template final prices unchanged, or default plan lines if no template. Explicit unit_price is final including variant adjustment. Omitted tax_ids copies product assignment. Only admin/staff may author draft lines.")
sub_create = {"customer_id": ID, "plan_id": ID, "template_id": nullable(ID), "payment_term_id": ID,
    "start_date": DATE, "expiry_date": nullable(DATE), "lines": array(ref("SubscriptionLineInput"))}
define("SubscriptionInput", sub_create, ["customer_id", "plan_id", "payment_term_id", "start_date", "expiry_date"], description="Always creates draft. If lines omitted, copy template or included plan products; explicit [] creates an incomplete draft. template_id must belong to selected plan.")
define("SubscriptionUpdate", {k: v for k, v in sub_create.items() if k not in ("customer_id", "template_id")}, [], minProperties=1, description="Draft only. lines replaces the complete draft line collection. Changing plan requires lines in the same request; customer cannot be reassigned.")
define("TaxEstimate", {"tax_id": ID, "name": NAME, "rate_percent": RATE, "amount": MONEY})
define("SubscriptionLine", {"id": ID, "product_id": ID, "variant_id": nullable(ID), "description": NAME,
    "quantity": DECIMAL, "unit_price": DECIMAL, "tax_ids": array(ID), "effective_from": DATE,
    "effective_until": nullable(DATE), "subtotal": MONEY, "tax_amount": MONEY, "total": MONEY, "taxes": array(ref("TaxEstimate"))}, description="Tax and total are current recurring estimates before automatic invoice discounts, not final invoice amounts.")
define("Capabilities", {k: BOOL for k in ["can_edit", "can_quote", "can_confirm", "can_activate", "can_pause", "can_resume", "can_renew", "can_close", "can_change_addons"]})
sub_summary = {**BASE, "number": NAME, "customer_id": ID, "customer_name": NAME, "plan_id": ID, "plan_name": NAME,
    "status": SUB_STATUS, "is_paused": BOOL, "currency": enum("INR"), "billing_interval": INTERVAL,
    "start_date": DATE, "expiry_date": nullable(DATE), "next_billing_date": nullable(DATE),
    "recurring_subtotal": MONEY, "estimated_tax_total": MONEY, "estimated_total": MONEY,
    "pause_effective_date": nullable(DATE), "resume_effective_date": nullable(DATE), "close_effective_date": nullable(DATE),
    "capabilities": ref("Capabilities")}
define("SubscriptionSummary", sub_summary)
define("Subscription", {**sub_summary, "template_id": nullable(ID), "payment_term_id": ID, "payment_term_name": NAME,
    "quotation_valid_until": nullable(DATE), "paused_at": nullable(TIME), "closed_at": nullable(TIME), "payment_due_days": integer(0),
    "policy_snapshot": obj({k: BOOL for k in ["auto_close", "allow_early_close", "allow_pause", "allow_renewal"]}),
    "lines": array(ref("SubscriptionLine"))})
define("QuoteInput", {"validity_days": integer(1, maximum=365)}, [], description="Default template validity, otherwise 7 days.")
define("ReasonInput", {"reason": text(minLength=1, maxLength=500)})
define("RenewInput", {"new_expiry_date": DATE})
define("EmptyInput", {})
define("AddonInput", {"product_id": ID, "variant_id": nullable(ID), "quantity": DECIMAL, "enabled": BOOL}, description="Quantity positive even when disabling. Effective date and price computed by server; never accepted from customer.")
define("AddonOption", {"product_id": ID, "name": NAME, "unit_price": DECIMAL,
    "variants": array(obj({"id": ID, "name": NAME, "price_adjustment": SIGNED})), "enabled": BOOL, "quantity": DECIMAL})
define("Event", {"id": ID, "subscription_id": ID, "actor_user_id": nullable(ID), "event_type": NAME,
    "previous_status": nullable(SUB_STATUS), "new_status": nullable(SUB_STATUS), "occurred_at": TIME,
    "summary": NAME}, description="Customer-safe audit projection: no staff email, secret tokens or internal payloads.")

define("InvoiceTax", {"tax_id": ID, "name": NAME, "rate_percent": RATE, "taxable_base": MONEY, "amount": MONEY})
define("InvoiceDiscount", {"discount_rule_id": ID, "name": NAME, "discount_type": enum("fixed", "percentage"), "value": DECIMAL, "amount": MONEY})
define("InvoiceLine", {"id": ID, "subscription_line_id": ID, "description": NAME, "quantity": DECIMAL,
    "unit_price": DECIMAL, "subtotal": MONEY, "discount_amount": MONEY, "tax_amount": MONEY,
    "total": MONEY, "taxes": array(ref("InvoiceTax")), "discounts": array(ref("InvoiceDiscount"))})
inv_summary = {**BASE, "number": NAME, "subscription_id": ID, "subscription_number": NAME, "customer_id": ID,
    "customer_name": NAME, "status": INV_STATUS, "currency": enum("INR"), "period_start": DATE,
    "period_end": DATE, "issue_date": DATE, "due_date": DATE, "subtotal": MONEY, "discount_total": MONEY,
    "tax_total": MONEY, "total": MONEY, "amount_paid": MONEY, "balance_due": MONEY, "is_overdue": BOOL,
    "capabilities": obj({k: BOOL for k in ["can_confirm", "can_cancel", "can_send", "can_print", "can_record_payment"]})}
define("InvoiceSummary", inv_summary)
define("Invoice", {**inv_summary, "billing_email": EMAIL, "billing_address": nullable(NOTE),
    "sent_at": nullable(TIME), "cancelled_at": nullable(TIME), "lines": array(ref("InvoiceLine"), minItems=1)})
define("PaymentInput", {"amount": MONEY, "method": enum("bank_transfer", "cash", "card", "other"), "payment_date": DATE, "note": nullable(NOTE)}, ["amount", "method", "payment_date"], description="Positive amount <= remaining invoice balance. Card is a recorded method, not a gateway charge.")
define("Payment", {"id": ID, "invoice_id": ID, "invoice_number": NAME, "customer_id": ID,
    "amount": MONEY, "currency": enum("INR"), "method": enum("bank_transfer", "cash", "card", "other"),
    "payment_date": DATE, "note": nullable(NOTE), "recorded_by": ID, "created_at": TIME})
define("PaymentResult", {"payment": ref("Payment"), "invoice": ref("InvoiceSummary")})
define("SendResult", {"delivery_id": ID, "invoice_id": ID, "status": enum("queued"), "recipient": EMAIL})
define("BillingRunInput", {"as_of": DATE, "limit": integer(1, maximum=1000), "subscription_id": ID}, ["as_of", "limit"], description="Admin only. as_of cannot exceed business today. Optional subscription_id narrows run. Limit counts periods, not subscriptions.")
define("BillingRun", {"id": ID, "status": enum("queued", "running", "completed", "completed_with_errors", "failed"),
    "as_of": DATE, "created_count": integer(), "reused_count": integer(), "failed_count": integer(),
    "has_more": BOOL, "next_run_required": BOOL, "created_at": TIME, "finished_at": nullable(TIME),
    "errors": array(obj({"subscription_id": ID, "period_start": DATE, "code": NAME, "message": NAME}))})
define("Overview", {"from": DATE, "to": DATE, "as_of": DATE, "currency": enum("INR"),
    "active_subscriptions": integer(), "paused_subscriptions": integer(), "invoiced_total": MONEY,
    "payments_received": MONEY, "outstanding_balance": MONEY, "overdue_balance": MONEY,
    "overdue_invoice_count": integer(), "monthly": array(obj({"month": text(pattern=r"^[0-9]{4}-[0-9]{2}$"), "invoiced_total": MONEY, "payments_received": MONEY})),
    "revenue_basis": enum("invoiced_excluding_cancelled")})


def param(name, schema, where="query", required=False, description=""):
    return {"name": name, "in": where, "required": required, "schema": schema, "description": description}


CSRF = param("X-CSRF-Token", text(minLength=32), "header", True, "Fetch /auth/csrf before first mutation; use rotated token returned after login.")
KEY = param("Idempotency-Key", ID, "header", True, "Fresh UUID per logical write; reuse on retries with identical path, body and If-Match.")
MATCH = param("If-Match", text(pattern=r'^"[1-9][0-9]*"$'), "header", True, 'Quoted version from last response, e.g. "1". Missing =>428, stale=>412.')


def envelope(name):
    return define(name+"Response", {"data": ref(name)})


def list_schema(name):
    return define(name+"ListResponse", {"data": array(ref(name)), "meta": ref("PageMeta")})


def response(schema, description="Success"):
    return {"description": description, "content": {"application/json": {"schema": schema}}}


ERROR_CODES = {"400": "Malformed request or unsupported query", "401": "Authentication required",
    "403": "Role or CSRF denied", "404": "Missing record or record outside customer ownership",
    "409": "State, policy, uniqueness or idempotency conflict", "412": "Stale resource version",
    "422": "Field validation failed", "428": "Required precondition missing", "429": "Rate limited", "500": "Unexpected server error"}


def op(path, method, operation_id, title, roles, output=None, body=None, status=200,
       description="", params=None, version=False, idem=None, public=False, raw=False):
    parameters = list(params or [])
    for part in path.split('/'):
        if part.startswith('{'):
            parameters.append(param(part[1:-1], ID, "path", True))
    write = method in ("post", "patch", "put", "delete")
    if write:
        parameters.append(copy.deepcopy(CSRF))
    if idem is None:
        idem = write and not path.startswith('/auth/')
    if idem:
        parameters.append(copy.deepcopy(KEY))
    if version:
        parameters.append(copy.deepcopy(MATCH))
    responses = {str(status): {"description": "No content"} if status == 204 else response(envelope(output))}
    if raw:
        responses[str(status)] = {"description": "Invoice PDF bytes, ownership checked on every request", "content": {"application/pdf": {"schema": text(format="binary")}}}
    responses.update({code: response(ref("Error"), desc) for code, desc in ERROR_CODES.items()})
    spec = {"operationId": operation_id, "summary": title, "description": description or title,
        "tags": [path.strip('/').split('/')[0]], "x-roles": roles, "parameters": parameters,
        "responses": responses, "security": [] if public else [{"sessionCookie": []}]}
    if body:
        spec["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(body)}}}
    PATHS.setdefault(path, {})[method] = spec
    return spec


def listing(path, name, roles, filters=None, sort_fields=("created_at",), description=""):
    pars = [param("page", integer(1, default=1)), param("page_size", integer(1, maximum=100, default=20)),
        param("q", text(maxLength=200)), param("sort_by", enum(*sort_fields)), param("sort_order", enum("asc", "desc"))]
    pars.extend(param(k, v) for k, v in (filters or {}).items())
    operation_id = "listInvoicePayments" if path == "/invoices/{id}/payments" else "list"+name
    spec = op(path, "get", operation_id, "List "+name, roles, name, params=pars, description=description)
    spec["responses"]["200"] = response(list_schema(name))


AS = ["admin", "staff"]
ALL = ["admin", "staff", "customer"]
ADMIN = ["admin"]
define('CustomerInvitationInput', {'token': text(pattern='^[a-f0-9]{64}$'), 'password': PASSWORD})
define('InvoiceDelivery', {'id': ID, 'invoice_id': ID, 'recipient': EMAIL, 'status': enum('pending', 'failed', 'sent', 'cancelled'),
    'attempts': integer(), 'last_attempt_at': nullable(TIME), 'sent_at': nullable(TIME), 'error': nullable(NOTE), 'created_at': TIME})
define('PlanOption', {'id': ID, 'name': NAME})
op('/auth/csrf', 'get', 'getCsrf', 'Get CSRF token', ['public'], 'Csrf', public=True, description='Sets anonymous session if absent. Safe and idempotent; no user data. Cache-Control: no-store.')
op('/auth/register', 'post', 'register', 'Register customer account', ['public'], 'User', 'RegisterInput', 201, public=True, description='Creates customer user/profile atomically, never staff/admin. Does not sign in. Never links an existing customer by matching billing_email alone.')
op('/auth/login', 'post', 'login', 'Sign in', ['public'], 'Session', 'LoginInput', public=True, description='Rotate session and CSRF token. Set HttpOnly session cookie; return no bearer token. Inactive users denied.')
op('/auth/me', 'get', 'getMe', 'Current session', ALL, 'Session')
op('/auth/logout', 'post', 'logout', 'Sign out', ALL, status=204, description='Invalidate session and expire cookie.')
op('/auth/forgot-password', 'post', 'forgotPassword', 'Request reset email', ['public'], 'Message', 'ForgotPasswordInput', 202, public=True, description='Always generic success regardless of account existence. Queue email if eligible; never return token.')
op('/auth/reset-password', 'post', 'resetPassword', 'Reset password', ['public'], 'Message', 'ResetPasswordInput', public=True, description='Consume expiring single-use token; invalidate existing sessions. Invalid/used/expired token =>422 RESET_TOKEN_INVALID.')

def resource(path, name, input_name, update_name, read_roles, write_roles=ADMIN, filters=None, desc=""):
    listing(path, name, read_roles, filters=filters, description=desc)
    op(path, 'post', 'create'+name, 'Create '+name, write_roles, name, input_name, 201)
    op(path+'/{id}', 'get', 'get'+name, 'Read '+name, read_roles, name, description=desc)
    op(path+'/{id}', 'patch', 'update'+name, 'Update '+name, write_roles, name, update_name, version=True, description='PATCH provided fields only; arrays replace complete collections. Omitted values unchanged; explicit null only where nullable. '+desc)

resource('/staff', 'Staff', 'StaffInput', 'StaffUpdate', ADMIN, desc='Admin only. Create a pending staff invitation; send single-use password setup email. Invitation never returns a password or token. Staff cannot grant roles.')
resource('/customers', 'Customer', 'CustomerInput', 'CustomerUpdate', AS, AS, desc='Staff-created customer has user_id null. Portal ownership requires single-use email invitation verification.')
op('/customers/{id}/invite', 'post', 'inviteCustomer', 'Invite customer to portal', AS, 'Message', 'EmptyInput', 202, version=True, description='Email an expiring single-use link to the current billing email. Never return the token. Reissuing invalidates older invitations. Linked customers cannot be invited.')
op('/auth/accept-customer-invitation', 'post', 'acceptCustomerInvitation', 'Accept verified customer invitation', ['public'], 'Message', 'CustomerInvitationInput', public=True, description='Consume the emailed token. New users choose a password; existing customer users must supply their current password. Only an empty existing signup profile may be replaced. Existing business records are never silently reassigned.')
resource('/products', 'Product', 'ProductInput', 'ProductUpdate', AS, filters={"is_active": BOOL}, desc='Staff projection must omit cost_price. No customer access. PATCH is_active=false archives; no hard delete.')
op('/products/{id}/variants', 'post', 'createVariant', 'Create product variant', ADMIN, 'Variant', 'VariantInput', 201)
op('/products/{id}/variants/{variant_id}', 'patch', 'updateVariant', 'Update product variant', ADMIN, 'Variant', 'VariantUpdate', version=True, description='If-Match refers to variant version. Verify variant belongs to path product. Existing subscription prices remain snapshots.')
resource('/plans', 'Plan', 'PlanInput', 'PlanUpdate', AS, filters={"is_active": BOOL, "billing_interval": INTERVAL})
resource('/taxes', 'Tax', 'TaxInput', 'TaxUpdate', AS, filters={"is_active": BOOL})
resource('/payment-terms', 'PaymentTerm', 'PaymentTermInput', 'PaymentTermUpdate', AS, filters={"is_active": BOOL})
resource('/quotation-templates', 'Template', 'TemplateInput', 'TemplateUpdate', AS, filters={"plan_id": ID, "is_active": BOOL})
resource('/discounts', 'Discount', 'DiscountInput', 'DiscountUpdate', ADMIN, filters={"scope": enum("product", "subscription"), "is_active": BOOL}, desc='Create complete target assignment. Monetary fields and targets immutable; replace with a new rule for changes. Archiving cannot retroactively change a billed invoice.')

listing('/subscriptions', 'SubscriptionSummary', ALL, {"status": SUB_STATUS, "is_paused": BOOL, "customer_id": ID, "plan_id": ID}, ("created_at", "number", "next_billing_date"), 'Customer results always ownership-filtered. Customer_id filter is staff/admin only; customers supplying it receive 403.')
op('/subscriptions', 'post', 'createSubscription', 'Create draft subscription', AS, 'Subscription', 'SubscriptionInput', 201)
op('/subscriptions/{id}', 'get', 'getSubscription', 'Read subscription detail', ALL, 'Subscription', description='Customer may read only own record; other customer IDs return 404.')
op('/subscriptions/{id}', 'patch', 'updateSubscription', 'Edit draft subscription', AS, 'Subscription', 'SubscriptionUpdate', version=True)
for action, body, roles, desc in [
    ('quote', 'QuoteInput', AS, 'draft -> quotation; requires nonempty valid lines; server sets valid-until.'),
    ('confirm', 'EmptyInput', AS, 'quotation -> confirmed; reject expired quote; snapshot plan policies and payment terms.'),
    ('activate', 'EmptyInput', AS, 'confirmed -> active; next_billing_date=start_date. Creates no invoice synchronously.'),
    ('pause', 'ReasonInput', ALL, 'Own active subscription and allow_pause only. Requested immediately, billing suppression begins next not-yet-started period; any started periods remain due.'),
    ('resume', 'EmptyInput', ALL, 'Own paused active subscription. Resume at next original recurrence boundary on/after business today; skipped paused periods are not billed.'),
    ('renew', 'RenewInput', ALL, 'Own active subscription; allow_renewal; new expiry strictly later than current expiry and aligned with recurrence boundary. No reopening closed subscriptions.'),
    ('close', 'ReasonInput', ALL, 'Own active subscription; allow_early_close; close effective next boundary. Existing invoices remain payable.'),
    ('addons', 'AddonInput', ALL, 'Schedule permitted plan add-on enable/disable at next not-yet-started billing boundary. Server computes price; no arbitrary products, dates or tax IDs accepted from customers.')]:
    op('/subscriptions/{id}/'+action, 'post', action+'Subscription', action.title()+' subscription', roles, 'Subscription', body, version=True, description=desc)
listing('/subscriptions/{id}/events', 'Event', ALL, sort_fields=('occurred_at',), description='Customer ownership enforced; events omit internal notes and secrets.')
op('/subscriptions/{id}/available-addons', 'get', 'listAvailableAddons', 'List allowed add-ons', ALL, 'AddonOption', description='Only plan-permitted add-ons, server prices and variants; no internal cost. Customer ownership required.')['responses']['200'] = response(obj({'data': array(ref('AddonOption'))}))

listing('/invoices', 'InvoiceSummary', ALL, {"status": INV_STATUS, "overdue": BOOL, "customer_id": ID, "subscription_id": ID, "from": DATE, "to": DATE}, ('created_at', 'number', 'due_date'), 'from/to inclusive issue dates. Customer_id filter staff/admin only. Customers always scoped by ownership.')
op('/invoices/{id}', 'get', 'getInvoice', 'Read invoice', ALL, 'Invoice', description='Customer ownership through subscription; customer_name and address are historical billing snapshots.')
op('/invoices/{id}/confirm', 'post', 'confirmInvoice', 'Confirm draft invoice', AS, 'Invoice', 'EmptyInput', version=True, description='draft -> confirmed. Snapshot totals already established by generation; cannot edit monetary lines.')
op('/invoices/{id}/cancel', 'post', 'cancelInvoice', 'Cancel unpaid invoice', AS, 'Invoice', 'ReasonInput', version=True, description='draft/confirmed with zero payments only. Cancels but does not delete, free period identity or restore discount usage. Paid or partly paid =>409.')
op('/invoices/{id}/send', 'post', 'sendInvoice', 'Queue invoice email', AS, 'SendResult', 'EmptyInput', 202, version=True, description='Confirmed/paid only. Durable outbox; recipient is billing_email snapshot. Repeated idempotency key queues once. sent_at means successful delivery, not queue time.')
op('/invoices/{id}/pdf', 'get', 'getInvoicePdf', 'Download invoice PDF', ALL, 'Invoice', raw=True, description='Ownership enforced. Draft/cancelled PDFs labelled appropriately; never a public permanent URL.')
op('/invoices/{id}/payments', 'post', 'recordPayment', 'Record invoice payment', AS, 'PaymentResult', 'PaymentInput', 201, version=True, description='If-Match is invoice version. Lock invoice; confirmed with balance only; no overpayments; identical retry returns original result before stale-version check.')
listing('/invoices/{id}/payments', 'Payment', ALL, sort_fields=('payment_date',), description='Owned customer invoice only. Do not include internal secrets in note; production may need a separate internal-note field.')
listing('/payments', 'Payment', AS, {"invoice_id": ID, "customer_id": ID, "from": DATE, "to": DATE}, ('payment_date', 'created_at'), 'from/to inclusive payment dates.')
op('/billing-runs', 'post', 'createBillingRun', 'Queue due-period billing run', ADMIN, 'BillingRun', 'BillingRunInput', 202, description='Persist run before acknowledgement; worker processes each subscription period transactionally. Repeated key returns same run. Scheduler invokes the same service internally, not browser credentials.')
op('/billing-runs/{id}', 'get', 'getBillingRun', 'Poll billing run', ADMIN, 'BillingRun')
listing('/billing-runs', 'BillingRun', ADMIN, description='Persistent billing history, newest first. q matches run UUID.')
op('/billing-runs/{id}/retry', 'post', 'retryBillingRun', 'Retry incomplete billing work', ADMIN, 'BillingRun', 'EmptyInput', 202, description='Create a fresh durable run with the original cutoff and subscription scope. Period uniqueness prevents duplicate invoices. Completed successful runs cannot be retried.')
listing('/invoices/{id}/deliveries', 'InvoiceDelivery', AS, description='Invoice email delivery attempts and sanitized errors. q matches recipient.')
op('/invoices/{id}/deliveries/{delivery_id}/retry', 'post', 'retryInvoiceDelivery', 'Retry failed invoice delivery', AS, 'InvoiceDelivery', 'EmptyInput', 202, description='Requeue a failed delivery only. Sent jobs cannot be retried; use Send for an intentional resend.')
listing('/portal/plans', 'PlanOption', ['customer'], sort_fields=('name',), description='Only plans referenced by the signed-in customer subscriptions, for filtering owned reports.')
report_params=[param('from', DATE, required=True), param('to', DATE, required=True), param('plan_id', ID)]
op('/reports/overview', 'get', 'getOverview', 'Get business overview', AS, 'Overview', params=report_params, description='See integration guide for period versus current-balance semantics. Inclusive date range <=366 days; from<=to<=business today.')
op('/portal/overview', 'get', 'getPortalOverview', 'Get own account overview', ['customer'], 'Overview', params=report_params, description='Same metrics restricted to own customer; no global figures. Details use shared ownership-protected subscription/invoice endpoints.')

SPEC = {"openapi": "3.1.0", "info": {"title": "Brightloop Subscription API", "version": "0.1.0",
    "description": "Implemented Brightloop REST API. Shared contracts and confirmed business policies are documented in docs/api-contracts.md. Generated by build_contract.py."},
    "servers": [{"url": "http://localhost:3000/api/v1", "description": "Proposed Express development address; no server is started by this file"}, {"url": "/api/v1", "description": "Same-origin proxy/production"}],
    "security": [{"sessionCookie": []}], "paths": PATHS,
    "components": {"securitySchemes": {"sessionCookie": {"type": "apiKey", "in": "cookie", "name": "brightloop_session", "description": "Opaque server session. HttpOnly; Secure in HTTPS; SameSite=Lax; Path=/. Never localStorage."}}, "schemas": SCHEMAS}}


def uid(n):
    return f"00000000-0000-4000-8000-{n:012d}"


NOW = "2026-10-31T04:30:00Z"
def base(n):
    return {"id": uid(n), "version": 1, "created_at": NOW, "updated_at": NOW}


sub = {**base(100), "number": "SUB-0001", "customer_id": uid(10), "customer_name": "Acme Studio", "plan_id": uid(30), "plan_name": "Starter",
    "status": "active", "is_paused": False, "currency": "INR", "billing_interval": "monthly", "start_date": "2026-10-01", "expiry_date": "2027-10-01",
    "next_billing_date": "2026-11-01", "recurring_subtotal": "1000.00", "estimated_tax_total": "180.00", "estimated_total": "1180.00",
    "pause_effective_date": None, "resume_effective_date": None, "close_effective_date": None,
    "capabilities": {k: k in ('can_pause','can_renew','can_change_addons') for k in SCHEMAS['Capabilities']['properties']},
    "template_id": None, "payment_term_id": uid(40), "payment_term_name": "Net 7", "payment_due_days": 7, "quotation_valid_until": "2026-10-07", "paused_at": None, "closed_at": None,
    "policy_snapshot": {"auto_close": True, "allow_early_close": False, "allow_pause": True, "allow_renewal": True},
    "lines": [{"id": uid(101), "product_id": uid(20), "variant_id": None, "description": "Business software - Standard", "quantity": "2.0000", "unit_price": "500.0000", "tax_ids": [uid(50)], "effective_from": "2026-10-01", "effective_until": None, "subtotal": "1000.00", "tax_amount": "180.00", "total": "1180.00", "taxes": [{"tax_id": uid(50), "name": "Example tax", "rate_percent": "18.0000", "amount": "180.00"}]}]}
inv = {**base(200), "number": "INV-0001", "subscription_id": uid(100), "subscription_number": "SUB-0001", "customer_id": uid(10), "customer_name": "Acme Studio", "status": "confirmed", "currency": "INR",
    "period_start": "2026-10-01", "period_end": "2026-11-01", "issue_date": "2026-10-01", "due_date": "2026-10-08", "subtotal": "1000.00", "discount_total": "0.00", "tax_total": "180.00", "total": "1180.00", "amount_paid": "500.00", "balance_due": "680.00", "is_overdue": True,
    "capabilities": {"can_confirm": False, "can_cancel": False, "can_send": True, "can_print": True, "can_record_payment": True},
    "billing_email": "billing@acme.example", "billing_address": "Example address", "sent_at": None, "cancelled_at": None,
    "lines": [{"id": uid(201), "subscription_line_id": uid(101), "description": "Business software - Standard", "quantity": "2.0000", "unit_price": "500.0000", "subtotal": "1000.00", "discount_amount": "0.00", "tax_amount": "180.00", "total": "1180.00", "taxes": [{"tax_id": uid(50), "name": "Example tax", "rate_percent": "18.0000", "taxable_base": "1000.00", "amount": "180.00"}], "discounts": []}]}
paid_inv = {k: copy.deepcopy(v) for k, v in inv.items() if k in SCHEMAS['InvoiceSummary']['properties']}
paid_inv.update(version=2, status='paid', amount_paid='1180.00', balance_due='0.00', is_overdue=False)
paid_inv['capabilities']['can_record_payment'] = False
draft_sub = copy.deepcopy(sub)
draft_sub.update(status='draft', next_billing_date=None, quotation_valid_until=None)
draft_sub['capabilities'] = {k: k in ('can_edit', 'can_quote') for k in SCHEMAS['Capabilities']['properties']}
fixtures = {
    'subscription-create': ('SubscriptionInput', {"customer_id": uid(10), "plan_id": uid(30), "payment_term_id": uid(40), "start_date": "2026-10-01", "expiry_date": "2027-10-01", "lines": [{"product_id": uid(20), "variant_id": None, "quantity": "2.0000"}]}),
    'subscription-active': ('SubscriptionResponse', {"data": sub}),
    'subscription-created': ('SubscriptionResponse', {"data": draft_sub}),
    'subscription-list': ('SubscriptionSummaryListResponse', {"data": [{k:v for k,v in sub.items() if k in SCHEMAS['SubscriptionSummary']['properties']}], "meta": {"page": 1, "page_size": 20, "total": 1, "total_pages": 1}}),
    'invoice-partial': ('InvoiceResponse', {"data": inv}),
    'payment-create': ('PaymentInput', {"amount": "680.00", "method": "bank_transfer", "payment_date": "2026-10-31", "note": "Remaining balance"}),
    'payment-result': ('PaymentResultResponse', {"data": {"payment": {"id": uid(300), "invoice_id": uid(200), "invoice_number": "INV-0001", "customer_id": uid(10), "amount": "680.00", "currency": "INR", "method": "bank_transfer", "payment_date": "2026-10-31", "note": "Remaining balance", "recorded_by": uid(1), "created_at": NOW}, "invoice": paid_inv}}),
    'overview': ('OverviewResponse', {"data": {"from": "2026-10-01", "to": "2026-10-31", "as_of": "2026-10-31", "currency": "INR", "active_subscriptions": 2, "paused_subscriptions": 0, "invoiced_total": "3304.00", "payments_received": "2624.00", "outstanding_balance": "680.00", "overdue_balance": "680.00", "overdue_invoice_count": 1, "monthly": [{"month": "2026-10", "invoiced_total": "3304.00", "payments_received": "2624.00"}], "revenue_basis": "invoiced_excluding_cancelled"}}),
    'validation-error': ('Error', {"error": {"code": "VALIDATION_ERROR", "message": "Correct the highlighted fields.", "fields": [{"path": "lines.0.quantity", "code": "MUST_BE_POSITIVE", "message": "Quantity must be greater than zero."}], "request_id": uid(900)}}),
    'customer-session': ('SessionResponse', {"data": {"user": {"id": uid(2), "email": "owner@acme.example", "display_name": "Acme owner", "role": "customer", "customer_id": uid(10), "is_active": True}, "csrf_token": "example-only-not-a-real-token-00000001", "expires_at": "2026-11-01T04:30:00Z"}})
}

# Embed representative examples where tools display them.
for _, (schema_name, value) in fixtures.items():
    SCHEMAS[schema_name]['examples'] = [value]


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT/'openapi.json').write_text(json.dumps(SPEC, indent=2)+"\n", encoding='utf-8')
    (ROOT/'examples').mkdir(exist_ok=True)
    manifest = {}
    for name, (schema_name, value) in fixtures.items():
        filename = name+'.json'
        (ROOT/'examples'/filename).write_text(json.dumps(value, indent=2)+"\n", encoding='utf-8')
        manifest[filename] = {"schema": schema_name}
    (ROOT/'examples'/'manifest.json').write_text(json.dumps(manifest, indent=2)+"\n", encoding='utf-8')
    print(f"Generated {sum(len(v) for v in PATHS.values())} operations, {len(SCHEMAS)} schemas and {len(fixtures)} examples.")


if __name__ == '__main__':
    main()
