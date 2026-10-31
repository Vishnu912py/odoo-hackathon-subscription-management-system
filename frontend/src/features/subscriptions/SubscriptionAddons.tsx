import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type PreparedMutation } from '../../api/client'
import type { AddonOption, Subscription } from '../../api/schema'
import { FormAlert } from '../live/FormFeedback'
export default function SubscriptionAddons({ subscription, onChanged, onExpired }: { subscription: Subscription; onChanged: () => void; onExpired: () => void }) {
  const [options, setOptions] = useState<AddonOption[]>([])
  const [product, setProduct] = useState(''), [variant, setVariant] = useState(''), [quantity, setQuantity] = useState('1.0000')
  const [enabled, setEnabled] = useState(true), [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PreparedMutation | null>(null), [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const controller = new AbortController()
    void api.get<{ data: AddonOption[] }>(`/subscriptions/${subscription.id}/available-addons`, {}, controller.signal)
      .then(result => setOptions(result.data)).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [subscription.id, subscription.version])
  async function submit(event: FormEvent) {
    event.preventDefault()
    const action = pending ?? api.prepare(`/subscriptions/${subscription.id}/addons`, 'POST', { product_id: product, variant_id: variant || null, quantity, enabled }, subscription.version)
    setPending(action); setBusy(true); setError(null)
    try { await api.send(action); setPending(null); onChanged() }
    catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500 && failure.code !== 'REQUEST_IN_PROGRESS') { setPending(null); onChanged() }
    } finally { setBusy(false) }
  }
  return <div className="panel"><h3>Subscription add-ons</h3>
    <p>Changes apply at the next eligible billing boundary. Existing billed periods keep their original charges.</p>
    {error !== null && <FormAlert error={error} />}
    {!options.length ? <p>No add-ons are available on this plan.</p> : <form onSubmit={submit}>
      <fieldset disabled={busy || !!pending}>
        <label>Add-on<select required value={product} onChange={event => { setProduct(event.target.value); setVariant('') }}><option value="">Choose an add-on</option>{options.map(option => <option key={option.product_id} value={option.product_id}>{option.name} · INR {option.unit_price}{option.enabled ? ' · enabled' : ''}</option>)}</select></label>
        <label>Variant<select value={variant} onChange={event => setVariant(event.target.value)}><option value="">No variant</option>{options.find(option => option.product_id === product)?.variants.map(option => <option key={option.id} value={option.id}>{option.name} (+{option.price_adjustment})</option>)}</select></label>
        <label>Quantity<input required inputMode="decimal" pattern="(0|[1-9][0-9]*)\.[0-9]{4}" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enable add-on</label>
      </fieldset>
      <button className="primary-button" disabled={busy || !product}>{pending ? 'Retry same change' : 'Save add-on change'}</button>
    </form>}
  </div>
}
