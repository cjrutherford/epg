import React from 'react'
import SelectFilter from './SelectFilter'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  lang: string
  onLangChange: (l: string) => void
  country: string
  onCountryChange: (c: string) => void
  area: string
  onAreaChange: (a: string) => void
  topic: string
  onTopicChange: (t: string) => void
  countryOnly?: boolean
  onCountryOnlyChange?: (v: boolean) => void
  langOptions: string[]
  countryOptions: string[]
  areaOptions: string[]
  topicOptions: string[]
}

const FilterBar = ({
  query,
  onQueryChange,
  lang,
  onLangChange,
  country,
    onCountryChange,
    countryOnly,
  onCountryOnlyChange,
  area,
  onAreaChange,
  topic,
  onTopicChange,
  langOptions,
  countryOptions,
  areaOptions,
  topicOptions
}: Props) => {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={countryOnly ?? false} onChange={(e) => onCountryOnlyChange && onCountryOnlyChange(e.target.checked)} />{' '}
          Country only
        </label>
      </div>

      <SelectFilter label="Lang" value={lang} options={langOptions} onChange={onLangChange} />
      <SelectFilter label="Country" value={country} options={countryOptions} onChange={onCountryChange} />
      <SelectFilter label="Area" value={area} options={areaOptions} onChange={onAreaChange} />
      <SelectFilter label="Topic" value={topic} options={topicOptions} onChange={onTopicChange} />
    </div>
  )
}

export default FilterBar
