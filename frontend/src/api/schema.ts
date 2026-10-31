// Generated from docs/api/openapi.json. Do not edit manually.
// Source SHA-256: 005601ff4523c63318489483fb1a828119b7b7ba489a18c4d5af4a19edcc3e2f

export type Error = { "error": { "code": string; "message": string; "fields": Array<{ "path": string; "code": string; "message": string }>; "request_id": string } }

export type PageMeta = { "page": number; "page_size": number; "total": number; "total_pages": number }

export type Message = { "message": string }

export type Csrf = { "csrf_token": string }

export type User = { "id": string; "email": string; "display_name": string; "role": "admin" | "staff" | "customer"; "customer_id": string | null; "is_active": boolean }

export type Session = { "user": User; "csrf_token": string; "expires_at": string }

export type LoginInput = { "email": string; "password": string }

export type RegisterInput = { "email": string; "password": string; "display_name": string; "company_name"?: string | null }

export type ForgotPasswordInput = { "email": string }

export type ResetPasswordInput = { "token": string; "password": string }

export type StaffInput = { "email": string; "display_name": string }

export type StaffUpdate = { "display_name"?: string; "is_active"?: boolean }

export type Staff = { "id": string; "version": number; "created_at": string; "updated_at": string; "email": string; "display_name": string; "role": "staff"; "is_active": boolean; "invitation_status": "pending" | "accepted" }

export type CustomerInput = { "name": string; "company_name"?: string | null; "billing_email": string; "billing_address"?: string | null }

export type CustomerUpdate = { "name"?: string; "company_name"?: string | null; "billing_email"?: string; "billing_address"?: string | null }

export type Customer = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "company_name": string | null; "billing_email": string; "billing_address": string | null; "user_id": string | null }

export type VariantInput = { "name": string; "attributes": { [key: string]: string }; "price_adjustment": string; "is_active"?: boolean }

export type VariantUpdate = { "name"?: string; "attributes"?: { [key: string]: string }; "price_adjustment"?: string; "is_active"?: boolean }

export type Variant = { "id": string; "version": number; "created_at": string; "updated_at": string; "product_id": string; "name": string; "attributes": { [key: string]: string }; "price_adjustment": string; "is_active": boolean }

export type ProductInput = { "name": string; "product_type": "service" | "goods"; "sales_price": string; "cost_price": string; "notes"?: string | null; "tax_ids": Array<string>; "is_active"?: boolean }

export type ProductUpdate = { "name"?: string; "product_type"?: "service" | "goods"; "sales_price"?: string; "cost_price"?: string; "notes"?: string | null; "tax_ids"?: Array<string>; "is_active"?: boolean }

export type Product = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "product_type": "service" | "goods"; "sales_price": string; "cost_price"?: string; "notes": string | null; "tax_ids": Array<string>; "is_active": boolean; "variants": Array<Variant> }

export type PlanProductInput = { "product_id": string; "default_quantity": string; "is_addon": boolean; "unit_price_override": string | null }

export type PlanProduct = { "id": string; "product_id": string; "default_quantity": string; "is_addon": boolean; "unit_price_override": string | null }

export type PlanInput = { "name": string; "price": string; "currency": "INR"; "billing_interval": "daily" | "weekly" | "monthly" | "yearly"; "minimum_quantity": string; "available_from": string | null; "available_until": string | null; "auto_close": boolean; "allow_early_close": boolean; "allow_pause": boolean; "allow_renewal": boolean; "is_active": boolean; "products": Array<PlanProductInput> }

export type PlanUpdate = { "name"?: string; "price"?: string; "currency"?: "INR"; "billing_interval"?: "daily" | "weekly" | "monthly" | "yearly"; "minimum_quantity"?: string; "available_from"?: string | null; "available_until"?: string | null; "auto_close"?: boolean; "allow_early_close"?: boolean; "allow_pause"?: boolean; "allow_renewal"?: boolean; "is_active"?: boolean; "products"?: Array<PlanProductInput> }

export type Plan = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "price": string; "currency": "INR"; "billing_interval": "daily" | "weekly" | "monthly" | "yearly"; "minimum_quantity": string; "available_from": string | null; "available_until": string | null; "auto_close": boolean; "allow_early_close": boolean; "allow_pause": boolean; "allow_renewal": boolean; "is_active": boolean; "products": Array<PlanProduct> }

export type TaxInput = { "name": string; "rate_percent": string; "is_active": boolean }

export type TaxUpdate = { "name"?: string; "is_active"?: boolean }

export type Tax = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "rate_percent": string; "is_active": boolean }

export type PaymentTermInput = { "name": string; "due_days": number; "is_active": boolean }

export type PaymentTermUpdate = { "name"?: string; "is_active"?: boolean }

export type PaymentTerm = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "due_days": number; "is_active": boolean }

export type TemplateLineInput = { "product_id": string; "variant_id": string | null; "quantity": string; "unit_price": string }

export type TemplateInput = { "name": string; "plan_id": string; "validity_days": number; "is_active": boolean; "lines": Array<TemplateLineInput> }

export type TemplateUpdate = { "name"?: string; "plan_id"?: string; "validity_days"?: number; "is_active"?: boolean; "lines"?: Array<TemplateLineInput> }

export type Template = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "plan_id": string; "validity_days": number; "is_active": boolean; "lines": Array<TemplateLineInput> }

export type DiscountInput = { "name": string; "discount_type": "fixed" | "percentage"; "value": string; "currency": "INR" | null; "scope": "product" | "subscription"; "product_ids": Array<string>; "subscription_ids": Array<string>; "minimum_purchase": string | null; "minimum_quantity": string | null; "valid_from": string; "valid_until": string | null; "usage_limit": number | null; "is_active": boolean }

export type DiscountUpdate = { "name"?: string; "is_active"?: boolean }

export type Discount = { "id": string; "version": number; "created_at": string; "updated_at": string; "name": string; "discount_type": "fixed" | "percentage"; "value": string; "currency": "INR" | null; "scope": "product" | "subscription"; "product_ids": Array<string>; "subscription_ids": Array<string>; "minimum_purchase": string | null; "minimum_quantity": string | null; "valid_from": string; "valid_until": string | null; "usage_limit": number | null; "is_active": boolean; "usage_count": number }

export type SubscriptionLineInput = { "product_id": string; "variant_id": string | null; "quantity": string; "unit_price"?: string; "tax_ids"?: Array<string> }

export type SubscriptionInput = { "customer_id": string; "plan_id": string; "template_id"?: string | null; "payment_term_id": string; "start_date": string; "expiry_date": string | null; "lines"?: Array<SubscriptionLineInput> }

export type SubscriptionUpdate = { "plan_id"?: string; "payment_term_id"?: string; "start_date"?: string; "expiry_date"?: string | null; "lines"?: Array<SubscriptionLineInput> }

export type TaxEstimate = { "tax_id": string; "name": string; "rate_percent": string; "amount": string }

export type SubscriptionLine = { "id": string; "product_id": string; "variant_id": string | null; "description": string; "quantity": string; "unit_price": string; "tax_ids": Array<string>; "effective_from": string; "effective_until": string | null; "subtotal": string; "tax_amount": string; "total": string; "taxes": Array<TaxEstimate> }

export type Capabilities = { "can_edit": boolean; "can_quote": boolean; "can_confirm": boolean; "can_activate": boolean; "can_pause": boolean; "can_resume": boolean; "can_renew": boolean; "can_close": boolean; "can_change_addons": boolean }

export type SubscriptionSummary = { "id": string; "version": number; "created_at": string; "updated_at": string; "number": string; "customer_id": string; "customer_name": string; "plan_id": string; "plan_name": string; "status": "draft" | "quotation" | "confirmed" | "active" | "closed"; "is_paused": boolean; "currency": "INR"; "billing_interval": "daily" | "weekly" | "monthly" | "yearly"; "start_date": string; "expiry_date": string | null; "next_billing_date": string | null; "recurring_subtotal": string; "estimated_tax_total": string; "estimated_total": string; "pause_effective_date": string | null; "resume_effective_date": string | null; "close_effective_date": string | null; "capabilities": Capabilities }

export type Subscription = { "id": string; "version": number; "created_at": string; "updated_at": string; "number": string; "customer_id": string; "customer_name": string; "plan_id": string; "plan_name": string; "status": "draft" | "quotation" | "confirmed" | "active" | "closed"; "is_paused": boolean; "currency": "INR"; "billing_interval": "daily" | "weekly" | "monthly" | "yearly"; "start_date": string; "expiry_date": string | null; "next_billing_date": string | null; "recurring_subtotal": string; "estimated_tax_total": string; "estimated_total": string; "pause_effective_date": string | null; "resume_effective_date": string | null; "close_effective_date": string | null; "capabilities": Capabilities; "template_id": string | null; "payment_term_id": string; "payment_term_name": string; "quotation_valid_until": string | null; "paused_at": string | null; "closed_at": string | null; "payment_due_days": number; "policy_snapshot": { "auto_close": boolean; "allow_early_close": boolean; "allow_pause": boolean; "allow_renewal": boolean }; "lines": Array<SubscriptionLine> }

export type QuoteInput = { "validity_days"?: number }

export type ReasonInput = { "reason": string }

export type RenewInput = { "new_expiry_date": string }

export type EmptyInput = {  }

export type AddonInput = { "product_id": string; "variant_id": string | null; "quantity": string; "enabled": boolean }

export type AddonOption = { "product_id": string; "name": string; "unit_price": string; "variants": Array<{ "id": string; "name": string; "price_adjustment": string }>; "enabled": boolean; "quantity": string }

export type Event = { "id": string; "subscription_id": string; "actor_user_id": string | null; "event_type": string; "previous_status": "draft" | "quotation" | "confirmed" | "active" | "closed" | null; "new_status": "draft" | "quotation" | "confirmed" | "active" | "closed" | null; "occurred_at": string; "summary": string }

export type InvoiceTax = { "tax_id": string; "name": string; "rate_percent": string; "taxable_base": string; "amount": string }

export type InvoiceDiscount = { "discount_rule_id": string; "name": string; "discount_type": "fixed" | "percentage"; "value": string; "amount": string }

export type InvoiceLine = { "id": string; "subscription_line_id": string; "description": string; "quantity": string; "unit_price": string; "subtotal": string; "discount_amount": string; "tax_amount": string; "total": string; "taxes": Array<InvoiceTax>; "discounts": Array<InvoiceDiscount> }

export type InvoiceSummary = { "id": string; "version": number; "created_at": string; "updated_at": string; "number": string; "subscription_id": string; "subscription_number": string; "customer_id": string; "customer_name": string; "status": "draft" | "confirmed" | "paid" | "cancelled"; "currency": "INR"; "period_start": string; "period_end": string; "issue_date": string; "due_date": string; "subtotal": string; "discount_total": string; "tax_total": string; "total": string; "amount_paid": string; "balance_due": string; "is_overdue": boolean; "capabilities": { "can_confirm": boolean; "can_cancel": boolean; "can_send": boolean; "can_print": boolean; "can_record_payment": boolean } }

export type Invoice = { "id": string; "version": number; "created_at": string; "updated_at": string; "number": string; "subscription_id": string; "subscription_number": string; "customer_id": string; "customer_name": string; "status": "draft" | "confirmed" | "paid" | "cancelled"; "currency": "INR"; "period_start": string; "period_end": string; "issue_date": string; "due_date": string; "subtotal": string; "discount_total": string; "tax_total": string; "total": string; "amount_paid": string; "balance_due": string; "is_overdue": boolean; "capabilities": { "can_confirm": boolean; "can_cancel": boolean; "can_send": boolean; "can_print": boolean; "can_record_payment": boolean }; "billing_email": string; "billing_address": string | null; "sent_at": string | null; "cancelled_at": string | null; "lines": Array<InvoiceLine> }

export type PaymentInput = { "amount": string; "method": "bank_transfer" | "cash" | "card" | "other"; "payment_date": string; "note"?: string | null }

export type Payment = { "id": string; "invoice_id": string; "invoice_number": string; "customer_id": string; "amount": string; "currency": "INR"; "method": "bank_transfer" | "cash" | "card" | "other"; "payment_date": string; "note": string | null; "recorded_by": string; "created_at": string }

export type PaymentResult = { "payment": Payment; "invoice": InvoiceSummary }

export type SendResult = { "delivery_id": string; "invoice_id": string; "status": "queued"; "recipient": string }

export type BillingRunInput = { "as_of": string; "limit": number; "subscription_id"?: string }

export type BillingRun = { "id": string; "status": "queued" | "running" | "completed" | "completed_with_errors" | "failed"; "as_of": string; "created_count": number; "reused_count": number; "failed_count": number; "has_more": boolean; "next_run_required": boolean; "created_at": string; "finished_at": string | null; "errors": Array<{ "subscription_id": string; "period_start": string; "code": string; "message": string }> }

export type Overview = { "from": string; "to": string; "as_of": string; "currency": "INR"; "active_subscriptions": number; "paused_subscriptions": number; "invoiced_total": string; "payments_received": string; "outstanding_balance": string; "overdue_balance": string; "overdue_invoice_count": number; "monthly": Array<{ "month": string; "invoiced_total": string; "payments_received": string }>; "revenue_basis": "invoiced_excluding_cancelled" }

export type CsrfResponse = { "data": Csrf }

export type UserResponse = { "data": User }

export type SessionResponse = { "data": Session }

export type MessageResponse = { "data": Message }

export type StaffResponse = { "data": Staff }

export type StaffListResponse = { "data": Array<Staff>; "meta": PageMeta }

export type CustomerResponse = { "data": Customer }

export type CustomerListResponse = { "data": Array<Customer>; "meta": PageMeta }

export type ProductResponse = { "data": Product }

export type ProductListResponse = { "data": Array<Product>; "meta": PageMeta }

export type VariantResponse = { "data": Variant }

export type PlanResponse = { "data": Plan }

export type PlanListResponse = { "data": Array<Plan>; "meta": PageMeta }

export type TaxResponse = { "data": Tax }

export type TaxListResponse = { "data": Array<Tax>; "meta": PageMeta }

export type PaymentTermResponse = { "data": PaymentTerm }

export type PaymentTermListResponse = { "data": Array<PaymentTerm>; "meta": PageMeta }

export type TemplateResponse = { "data": Template }

export type TemplateListResponse = { "data": Array<Template>; "meta": PageMeta }

export type DiscountResponse = { "data": Discount }

export type DiscountListResponse = { "data": Array<Discount>; "meta": PageMeta }

export type SubscriptionSummaryResponse = { "data": SubscriptionSummary }

export type SubscriptionSummaryListResponse = { "data": Array<SubscriptionSummary>; "meta": PageMeta }

export type SubscriptionResponse = { "data": Subscription }

export type EventResponse = { "data": Event }

export type EventListResponse = { "data": Array<Event>; "meta": PageMeta }

export type AddonOptionResponse = { "data": AddonOption }

export type InvoiceSummaryResponse = { "data": InvoiceSummary }

export type InvoiceSummaryListResponse = { "data": Array<InvoiceSummary>; "meta": PageMeta }

export type InvoiceResponse = { "data": Invoice }

export type SendResultResponse = { "data": SendResult }

export type PaymentResultResponse = { "data": PaymentResult }

export type PaymentResponse = { "data": Payment }

export type PaymentListResponse = { "data": Array<Payment>; "meta": PageMeta }

export type BillingRunResponse = { "data": BillingRun }

export type OverviewResponse = { "data": Overview }
