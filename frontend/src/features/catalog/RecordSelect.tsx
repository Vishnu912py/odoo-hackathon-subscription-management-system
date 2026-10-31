import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../api/client'

export default function RecordSelect({ resource, value, onChange, label, required = false, disabled = false }: {
  resource: string; value: string; onChange: (value: string) => void; label: string; required?: boolean; disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Array<{ id: string; name?: string; number?: string }>>([])
  const [error, setError] = useState('')
  const [selectedName, setSelectedName] = useState('Selected record')
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void api.get<{ data: typeof rows }>(resource, { q: search || undefined, page_size: 100 }, controller.signal)
        .then(result => { setRows(result.data); setError('') })
        .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [resource, search])
  return <fieldset disabled={disabled}>
    <input type="search" aria-label={`Search ${label}`} placeholder={`Search ${label.toLowerCase()}`} value={search} onChange={event => setSearch(event.target.value)} />
    <select aria-label={label} required={required} value={value} onChange={event => {
      const row = rows.find(item => item.id === event.target.value)
      setSelectedName(row?.name ?? row?.number ?? 'Selected record'); onChange(event.target.value)
    }}>
      <option value="">Choose {label.toLowerCase()}</option>
      {value && !rows.some(row => row.id === value) && <option value={value}>{selectedName}</option>}
      {rows.map(row => <option key={row.id} value={row.id}>{row.name ?? row.number}</option>)}
    </select>
    {error && <span role="alert">{error}</span>}
    {rows.length === 100 && <small>Refine your search to find more records.</small>}
  </fieldset>
}
