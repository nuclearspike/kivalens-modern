import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button } from 'react-bootstrap'
import numeral from 'numeral'
import type { Partner } from '../types'
import { useLoanStore, useCriteriaStore } from '../stores'
import KivaImage from './KivaImage'

interface PartnerDetailProps {
  partner: Partner
  showStatus?: boolean
}

const statusVariant: Record<string, string> = {
  active: 'success',
  inactive: 'secondary',
  paused: 'warning',
  closed: 'danger',
}

function KivaLink({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <a href={`https://www.kiva.org/${path}`} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

export default function PartnerDetail({ partner, showStatus = true }: PartnerDetailProps) {
  const navigate = useNavigate()
  const loans = useLoanStore((s) => s.loans)
  const setCriteria = useCriteriaStore((s) => s.setCriteria)
  const blankCriteria = useCriteriaStore((s) => s.blankCriteria)

  const loanCount = useMemo(() => {
    if (partner.status !== 'active') return 0
    return loans.filter((l) => l.partner_id === partner.id && l.status === 'fundraising').length
  }, [loans, partner.id, partner.status])

  const searchLoans = () => {
    const crit = blankCriteria()
    ;(crit.partner as Record<string, unknown>).partners = partner.id.toString()
    setCriteria(crit)
    navigate('/search')
  }

  const countryNames = partner.countries?.map((c) => c.name).join(', ') ?? '(unknown)'
  const atheistScore = partner.atheistScore
  const showAtheistResearch = !!atheistScore
  const metricPillClass = (value: number | null | undefined, lowGood = true) => {
    if (value == null || Number.isNaN(value)) return 'partner-pill-muted'
    if (lowGood) {
      if (value < 3) return 'partner-pill-good'
      if (value < 8) return 'partner-pill-warn'
      return 'partner-pill-bad'
    }
    if (value >= 4.5) return 'partner-pill-good'
    if (value >= 3) return 'partner-pill-warn'
    return 'partner-pill-bad'
  }

  return (
    <div className="PartnerDetail">
      {loanCount > 0 && (
        <div
          className="d-flex align-items-center justify-content-between mb-2 p-2 rounded"
          style={{ background: '#e8f5e9' }}
        >
          <span>
            <b>{numeral(loanCount).format('0,0')}</b> fundraising loan
            {loanCount !== 1 ? 's' : ''}
          </span>
          <Button size="sm" variant="success" onClick={searchLoans}>
            Show Loans
          </Button>
        </div>
      )}

      <h2>
        <KivaLink path={`about/where-kiva-works/partners/${partner.id}`}>
          <span
            className="d-inline-block text-center text-white fw-bold align-middle"
            style={{
              width: 18,
              height: 18,
              lineHeight: '18px',
              borderRadius: '50%',
              background: '#2C8C5E',
              fontSize: 11,
              marginRight: 6,
              position: 'relative',
              top: -2,
            }}
          >
            K
          </span>
        </KivaLink>
        {partner.name}
        {showStatus && partner.status !== 'active' && (
          <>{' '}
            <Badge bg={statusVariant[partner.status] ?? 'secondary'}>{partner.status}</Badge>
          </>
        )}
      </h2>

      <div className="d-flex flex-wrap gap-2 mb-3">
        {(partner.countries ?? []).map((country) => (
          <span key={country.iso_code} className="partner-pill partner-pill-muted">
            {country.name}
          </span>
        ))}
        {partner.rating != null ? (
          <span className={`partner-pill ${metricPillClass(Number(partner.rating), false)}`}>
            {partner.rating} stars
          </span>
        ) : null}
        {partner.portfolio_yield != null ? (
          <span className="partner-pill partner-pill-accent">
            PY {numeral(partner.portfolio_yield).format('0.0')}%
          </span>
        ) : null}
      </div>

      <div className="row">
        <div className="col-lg-6">
          <dl className="row small">
            <dt className="col-sm-5">Rating</dt>
            <dd className="col-sm-7">
              {partner.rating != null ? (
                <span className={`partner-pill ${metricPillClass(Number(partner.rating), false)}`}>
                  {partner.rating}
                </span>
              ) : 'N/A'}
            </dd>

            {partner.status !== 'active' && (
              <>
                <dt className="col-sm-5">Status</dt>
                <dd className="col-sm-7 text-capitalize">{partner.status}</dd>
              </>
            )}

            <dt className="col-sm-5">Start Date</dt>
            <dd className="col-sm-7">
              {new Date(partner.start_date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </dd>

            <dt className="col-sm-5">
              {partner.countries?.length === 1 ? 'Country' : 'Countries'}
            </dt>
            <dd className="col-sm-7">{countryNames}</dd>

            <dt className="col-sm-5">Delinquency</dt>
            <dd className="col-sm-7">
              <span className={`partner-pill ${metricPillClass(partner.delinquency_rate)}`}>
                {numeral(partner.delinquency_rate).format('0.000')}%
              </span>
            </dd>

            <dt className="col-sm-5">Loans at Risk Rate</dt>
            <dd className="col-sm-7">
              <span className={`partner-pill ${metricPillClass(partner.loans_at_risk_rate)}`}>
                {numeral(partner.loans_at_risk_rate).format('0.000')}%
              </span>
            </dd>

            <dt className="col-sm-5">Default</dt>
            <dd className="col-sm-7">
              <span className={`partner-pill ${metricPillClass(partner.default_rate)}`}>
                {numeral(partner.default_rate).format('0.000')}%
              </span>
            </dd>

            <dt className="col-sm-5">Loans Posted</dt>
            <dd className="col-sm-7">{numeral(partner.loans_posted).format('0,0')}</dd>

            <dt className="col-sm-5">Portfolio Yield</dt>
            <dd className="col-sm-7">
              {partner.portfolio_yield != null
                ? <span className="partner-pill partner-pill-accent">{numeral(partner.portfolio_yield).format('0.0')}%</span>
                : '(unknown)'}
            </dd>

            <dt className="col-sm-5">Profitability</dt>
            <dd className="col-sm-7">
              {partner.profitability != null
                ? <span className="partner-pill partner-pill-accent">{numeral(partner.profitability).format('0.0')}%</span>
                : '(unknown)'}
            </dd>

            <dt className="col-sm-5">Charges Fees/Interest</dt>
            <dd className="col-sm-7">
              <span className={`partner-pill ${partner.charges_fees_and_interest ? 'partner-pill-warn' : 'partner-pill-good'}`}>
                {partner.charges_fees_and_interest ? 'Yes' : 'No'}
              </span>
            </dd>

            <dt className="col-sm-5">Avg Loan/Cap Income</dt>
            <dd className="col-sm-7">
              {numeral(partner.average_loan_size_percent_per_capita_income).format('0.00')}%
            </dd>

            <dt className="col-sm-5">Currency Ex Loss</dt>
            <dd className="col-sm-7">
              {numeral(partner.currency_exchange_loss_rate).format('0.000')}%
            </dd>
          </dl>
        </div>

        <div className="col-lg-6">
          <KivaImage
            image_id={(partner as unknown as { image?: { id: number } }).image?.id}
            image_width={800}
            width={800}
            type="width"
          />
        </div>
      </div>

      {partner.kl_sp && partner.kl_sp.length > 0 && partner.social_performance_strengths && (
        <div className="mt-3">
          <h4>Social Performance Strengths</h4>
          <ul>
            {partner.social_performance_strengths.map((sp, i) => (
              <li key={i}>
                <b>{(sp as unknown as { name: string }).name}</b>
                {': '}
                {(sp as unknown as { description: string }).description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showAtheistResearch && atheistScore && (
        <div className="mt-3">
          <h4>A+ Team Research</h4>
          <dl className="row small">
            <dt className="col-sm-4">Secular Rating</dt>
            <dd className="col-sm-8">{atheistScore.secularRating}</dd>

            <dt className="col-sm-4">Religious Affiliation</dt>
            <dd className="col-sm-8">{atheistScore.religiousAffiliation}</dd>

            <dt className="col-sm-4">Comments on Secular Rating</dt>
            <dd className="col-sm-8">{atheistScore.commentsOnSecularRating}</dd>

            <dt className="col-sm-4">Social Rating</dt>
            <dd className="col-sm-8">{atheistScore.socialRating}</dd>

            <dt className="col-sm-4">Comments on Social Rating</dt>
            <dd className="col-sm-8">{atheistScore.commentsOnSocialRating}</dd>

            <dt className="col-sm-4">Review Comments</dt>
            <dd className="col-sm-8">{atheistScore.reviewComments}</dd>
          </dl>
        </div>
      )}
    </div>
  )
}
