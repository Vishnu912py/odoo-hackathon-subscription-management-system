import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import RecordSelect from './RecordSelect'
export default function RecordMultiSelect({ resource, value, onChange, label, disabled = false }: {
  resource: string; value: string; onChange: (value: string) => void; label: string; disabled?: boolean
}) {
  const [selected, setSelected] = useState('')
  const ids = value.split(',').map(id => id.trim()).filter(Boolean)
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const controller = new AbortController()
    const selectedIds = value.split(',').map(id => id.trim()).filter(Boolean)
    void Promise.all(selectedIds.map(async id => {
      const result = await api.get<{ data: { name?: string; number?: string } }>(`${resource}/${id}`, {}, controller.signal)
      return [id, result.data.name ?? result.data.number ?? 'Selected record'] as const
    })).then(entries => { if (!controller.signal.aborted) setNames(Object.fromEntries(entries)) }).catch(() => {})
    return () => controller.abort()
  }, [resource, value])
  return <fieldset disabled={disabled}>
    <legend>{label}</legend>
    <RecordSelect resource={resource} label={label} value={selected} onChange={setSelected} />
    <button type="button" disabled={!selected || ids.includes(selected)} onClick={() => { onChange([...ids, selected].join(', ')); setSelected('') }}>Add selection</button>
    <p>{ids.length} selected</p>
    {ids.map((id, index) => <button key={id} type="button" onClick={() => onChange(ids.filter(value => value !== id).join(', '))}>Remove {names[id] ?? `selection ${index + 1}`}</button>)}
  </fieldset>
}
