import type { BasketEntry } from '../stores'
import { useLoanStore } from '../stores'
import KivaImage from './KivaImage'
import { lendAmountOptions } from '../lib/lendAmountOptions'
import type { ChangeEvent } from 'react'

interface BasketListItemProps {
  entry: BasketEntry
  onSelect: (id: number) => void
  onRemove?: (id: number) => void
  isSelected: boolean
}

/**
 * Individual basket row showing loan image, borrower name, country/sector,
 * amount dropdown (via lendAmountOptions), and a remove button.
 */
export default function BasketListItem({ entry, onSelect, onRemove, isSelected }: BasketListItemProps) {
  const setBasketAmount = useLoanStore((s) => s.setBasketAmount)
  const removeFromBasket = useLoanStore((s) => s.removeFromBasket)
  const loan = entry.loan

  if (!loan) return null

  const stillNeeded = loan.kl_still_needed ?? 0
  let options = lendAmountOptions(stillNeeded)
  // If current amount is not in options (e.g. max changed), insert it so the select shows the real value
  if (options.length && !options.includes(entry.amount)) {
    options = [entry.amount, ...options].sort((a, b) => a - b)
  }

  const handleAmountChange = (e: ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    setBasketAmount(entry.id, parseInt(e.target.value, 10))
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    removeFromBasket(entry.id)
    onRemove?.(entry.id)
  }

  return (
    <div
      className={`list-group-item loan_list_item${isSelected ? ' active' : ''}`}
      onClick={() => onSelect(entry.id)}
      role="button"
      tabIndex={0}
    >
      <KivaImage type="square" loan={loan} image_width={113} width={90} height={90} />
      <div className="details">
        <div className="loan-name">{loan.name}</div>
        <div className="loan-meta">
          <span className="loan-tag">{loan.location.country}</span>
          <span className="loan-tag">{loan.sector}</span>
        </div>
        <div className="d-flex align-items-center gap-2 mt-1">
          {options.length > 0 ? (
            <select
              value={entry.amount}
              onChange={handleAmountChange}
              onClick={(e) => e.stopPropagation()}
              className="form-select form-select-sm"
              style={{ width: 'auto', minWidth: 80 }}
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  ${o}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-danger small fw-semibold">
              Fully funded -- will be removed on checkout
            </span>
          )}
          <button
            className="btn btn-outline-danger btn-sm ms-auto flex-shrink-0"
            onClick={handleRemove}
            title="Remove from basket"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  )
}
