import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../api/client'
import type { ProductResponse } from '../../api/schema'
export default function VariantSelect({ productId, value, onChange }: { productId: string; value: string; onChange: (id: string) => void }) {
  const [variants, setVariants] = useState<ProductResponse['data']['variants']>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!productId) return
    const controller = new AbortController()
    void api.get<ProductResponse>(`/products/${productId}`, {}, controller.signal).then(result => setVariants(result.data.variants))
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)) })
    return () => controller.abort()
  }, [productId])
  return <><select aria-label="Variant" value={value} disabled={!productId} onChange={event => onChange(event.target.value)}><option value="">No variant</option>
    {variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name} (+{variant.price_adjustment})</option>)}</select>{error && <span role="alert">{error}</span>}</>
}
