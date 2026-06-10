import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useLoanStore } from '../stores'
import type { BasketEntry } from '../stores'
import BasketListItem from './BasketListItem'
import Loan from './Loan'
import { getKivaLoans } from '../api/kiva'

// ---------------------------------------------------------------------------
// BasketRepaymentChart - combined repayment forecast across all basket items
// ---------------------------------------------------------------------------

interface BasketRepaymentDatum {
  label: string
  amount: number
  cumulativeAmount: number
}

function BasketRepaymentChart({ entries }: { entries: BasketEntry[] }) {
  const { data, skippedCount } = useMemo(() => {
    const monthMap = new Map<string, { amount: number; date: number }>()
    let skipped = 0

    for (const entry of entries) {
      const loan = entry.loan
      if (!loan?.kl_still_needed || !loan.kl_repayments?.length || !loan.loan_amount) {
        skipped += 1
        continue
      }
      const share = entry.amount / loan.loan_amount
      for (const rep of loan.kl_repayments) {
        const key = rep.display
        const existing = monthMap.get(key)
        monthMap.set(key, {
          amount: (existing?.amount ?? 0) + rep.amount * share,
          date: new Date(rep.date).getTime(),
        })
      }
    }

    if (monthMap.size === 0) {
      return { data: [] as BasketRepaymentDatum[], skippedCount: skipped }
    }

    const sorted = Array.from(monthMap.entries()).sort(([, a], [, b]) => a.date - b.date)
    let cumulative = 0
    const chartData = sorted.map(([label, month]) => {
      cumulative += month.amount
      return {
        label,
        amount: Math.round(month.amount * 100) / 100,
        cumulativeAmount: Math.round(cumulative * 100) / 100,
      }
    })

    return { data: chartData, skippedCount: skipped }
  }, [entries])

  if (!data.length) {
    if (skippedCount > 0) {
      return (
        <div className="card mb-3">
          <div className="card-body">
            <div className="alert alert-info mb-0">
              Repayment schedule data is not yet available for the loans in your basket.
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  const chartHeight = Math.max(300, Math.min(data.length * 22, 900))

  return (
    <div className="card mb-3">
      <div className="card-header">Repayments for Basket: {data.length} months</div>
      <div className="card-body p-2">
        {skippedCount > 0 ? (
          <div className="alert alert-warning py-1 mb-2">
            Repayment data unavailable for {skippedCount} of {entries.length} loans.
          </div>
        ) : null}
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ComposedChart data={data} layout="vertical" margin={{ left: 40, right: 10, top: 5, bottom: 5 }}>
            <XAxis xAxisId="amount" type="number" orientation="bottom" hide />
            <XAxis xAxisId="cumulative" type="number" orientation="top" hide />
            <YAxis dataKey="label" type="category" tick={{ fontSize: 9 }} width={60} />
            <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
            <Bar
              xAxisId="amount"
              dataKey="amount"
              fill="#e8871a"
              name="Monthly Repayment"
              barSize={16}
            />
            <Area
              xAxisId="cumulative"
              dataKey="cumulativeAmount"
              stroke="#2C8C5E"
              fill="rgba(44, 140, 94, 0.15)"
              name="Cumulative"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/**
 * Basket page showing all basket items, total amount, and checkout button.
 * Checkout builds a Kiva URL and submits the basket via a hidden form POST.
 */
export default function Basket() {
  const getBasket = useLoanStore((s) => s.getBasket)
  const clearBasket = useLoanStore((s) => s.clearBasket)
  const basketSignature = useLoanStore((s) =>
    s.basket.map((item) => `${item.loan_id}:${item.amount}`).join(','),
  )
  const rawBasketCount = useLoanStore((s) => s.basket.length)
  const loanCount = useLoanStore((s) => s.loans.length)
  const downloading = useLoanStore((s) => s.downloading)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTransfer, setShowTransfer] = useState(false)

  // Fetch full details for basket loans missing repayment data
  const [repayVersion, setRepayVersion] = useState(0)
  const basketEntries: BasketEntry[] = useMemo(
    () => getBasket(),
    [basketSignature, getBasket, rawBasketCount, loanCount, repayVersion],
  )
  useEffect(() => {
    const missing = basketEntries
      .filter((e) => e.loan && !e.loan.kl_repayments?.length)
    if (missing.length) {
      const kl = getKivaLoans()
      const loans = missing.map((e) => e.loan!)
      kl.fetchDescrAndRepayments(loans).then(() => setRepayVersion((v) => v + 1))
    }
  }, [basketEntries.map((e) => e.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedId != null && !basketEntries.some((entry) => entry.id === selectedId)) {
      setSelectedId(null)
    }
  }, [basketEntries, selectedId])

  const amountSum = useMemo(
    () =>
      basketEntries
        .filter((e) => e.loan && (e.loan.kl_still_needed ?? 0) > 0)
        .reduce((sum, e) => sum + e.amount, 0),
    [basketEntries],
  )

  const basketCount = basketEntries.length

  // Build the JSON payload for Kiva's /basket/set endpoint
  const makeBasketPayload = useCallback((): string => {
    return JSON.stringify(
      basketEntries
        .filter((e) => e.loan && (e.loan.kl_still_needed ?? 0) > 0)
        .map((e) => ({ id: e.id, amount: e.amount })),
    )
  }, [basketEntries])

  const handleClear = () => {
    if (window.confirm('Are you sure you want to empty your basket?')) {
      clearBasket()
      setSelectedId(null)
    }
  }

  const handleCheckout = () => {
    if (basketCount === 0) return
    setShowTransfer(true)

    // Submit the hidden form to transfer basket to Kiva
    const form = document.getElementById('kiva-basket-form') as HTMLFormElement | null
    if (form) {
      // Set the hidden input values right before submit
      const loansInput = form.querySelector<HTMLInputElement>('input[name="loans"]')
      if (loansInput) loansInput.value = makeBasketPayload()
      setTimeout(() => form.submit(), 500)
    }
  }

  const handleSelect = (id: number) => {
    setSelectedId(id)
  }

  const callbackUrl = `${location.protocol}//${location.host}${location.pathname}#clear-basket`

  return (
    <div className="d-flex h-100 w-100">
      {/* Left column: basket list */}
      <div className="col-md-3 d-flex flex-column">
        <div className="btn-group w-100 mb-0">
          <button
            className="btn btn-outline-secondary"
            disabled={basketCount === 0}
            onClick={handleClear}
          >
            Empty Basket
          </button>
        </div>

        {basketCount === 0 ? (
          <div className="alert alert-info mt-2">
            There are no loans in your basket. To add loans:
            <ul className="mb-0 mt-1">
              <li>Click the "Lend" button when viewing a loan.</li>
              <li>Double-click a loan in the results.</li>
              <li>Use the "Bulk Add" button to add many loans at once.</li>
            </ul>
          </div>
        ) : null}

        {rawBasketCount > 0 && basketCount === 0 && downloading ? (
          <div className="alert alert-warning mt-2">
            Loans in your basket are being restored. Please wait while loan data finishes loading.
          </div>
        ) : null}

        <div className="list-group flex-grow-1 overflow-auto">
          {basketEntries.map((entry) => (
            <BasketListItem
              key={entry.id}
              entry={entry}
              onSelect={handleSelect}
              onRemove={(id) => {
                if (selectedId === id) {
                  setSelectedId(null)
                }
              }}
              isSelected={selectedId === entry.id}
            />
          ))}
        </div>
      </div>

      {/* Center column: summary + checkout */}
      <div className="col-md-3 px-3">
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title mb-2">
              Basket: {basketCount} loan{basketCount !== 1 ? 's' : ''} ${amountSum}
            </h5>
            <form
              id="kiva-basket-form"
              method="POST"
              action="https://www.kiva.org/basket/set"
              target="_blank"
            >
              <input name="callback_url" value={callbackUrl} type="hidden" />
              <input name="loans" value={makeBasketPayload()} type="hidden" />
              <input name="donation" value="0.00" type="hidden" />
              <input name="app_id" value="org.kiva.kivalens" type="hidden" />
            </form>
            <button
              className="btn btn-success"
              disabled={basketCount === 0}
              onClick={handleCheckout}
            >
              Checkout at Kiva
            </button>
          </div>
        </div>

        {basketCount > 0 && <BasketRepaymentChart entries={basketEntries} />}
      </div>

      {/* Right column: loan detail */}
      <div className="col-md-6 overflow-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
        {selectedId ? <Loan loanId={selectedId} /> : null}
      </div>

      {/* Transfer modal */}
      {showTransfer && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Transferring Basket to Kiva</h5>
              </div>
              <div className="modal-body">
                <p>
                  Depending upon the number of loans in your basket, transferring your selection
                  to Kiva could take some time. Please wait.
                </p>
              </div>
              <div className="modal-footer">
                <div className="progress w-100">
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
