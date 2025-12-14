import React from 'react'

type Props = {
  label?: string
  value: string
  options: string[]
  onChange: (value: string) => void
}

const SelectFilter = ({ label, value, options, onChange }: Props) => {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      {label || 'Filter'}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 100 }}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

export default SelectFilter
