import cx from 'classnames'
import { ListGroup } from 'react-bootstrap'
import { useLoanStore } from '../stores'
import type { KivaLoan } from '../types'
import KivaImage from './KivaImage'
import { lendAmountOptions } from '../lib/lendAmountOptions'
import { lsj } from '../lib/localStorage'

interface LoanListItemProps {
  loan: KivaLoan
}

/**
 * Compact card for a single loan in the search results list.
 */
export default function LoanListItem({ loan }: LoanListItemProps) {
  const inBasket = useLoanStore((s) => s.inBasket(loan.id))
  const addToBasket = useLoanStore((s) => s.addToBasket)
  const selectedId = useLoanStore((s) => s.selectedId)
  const setSelectedId = useLoanStore((s) => s.setSelectedId)

  const isSelected = selectedId === loan.id
  const fundedPercent = loan.loan_amount
    ? Math.round((loan.funded_amount / loan.loan_amount) * 100)
    : 0

  const handleClick = () => {
    setSelectedId(loan.id)
  }

  const handleDoubleClick = () => {
    const options = lendAmountOptions(loan.kl_still_needed ?? 0)
    const defaultAmount =
      lsj.get<{ default_lend_amount?: number }>('Options').default_lend_amount ?? 25
    const amount = options.filter((o) => o <= defaultAmount).pop() ?? options[0] ?? 25
    addToBasket(loan.id, amount)
  }

  return (
    <ListGroup.Item
      action
      className={cx('loan_list_item', {
        selected: isSelected,
        in_basket: inBasket,
        funded: loan.status !== 'fundraising',
      })}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <KivaImage type="square" loan={loan} image_width={113} width={90} height={90} />
      <div className="details">
        <div className="loan-name">{loan.name}</div>
        <div className="loan-meta">
          <span className="loan-tag">{loan.location.country}</span>
          <span className="loan-tag">{loan.sector}</span>
          <span className="loan-tag d-none d-lg-inline">{loan.activity}</span>
        </div>
        <div className="loan-use d-none d-lg-block">{loan.use}</div>
        <div className="loan-progress">
          <div className="progress" style={{ height: 4 }}>
            <div
              className="progress-bar bg-success"
              style={{ width: `${fundedPercent}%` }}
            />
          </div>
        </div>
      </div>
    </ListGroup.Item>
  )
}
