import { useState, useCallback } from 'react'
import { Container, Col, Row, Alert, ButtonGroup, Button, ListGroup } from 'react-bootstrap'
import numeral from 'numeral'
import { useLoanStore, useUtilsStore } from '../stores'
import { Criteria } from './Criteria'
import LoanListItem from './LoanListItem'
import Loan from './Loan'
import DidYouKnow from './DidYouKnow'
import LoadingLoansPanel from './LoadingLoansPanel'
import BulkAddModal from './BulkAddModal'
import { showLenderIDModal } from '../lib/showLenderIdModal'

// ---------------------------------------------------------------------------
// Search page — criteria panel + loan list + detail area
// ---------------------------------------------------------------------------

export function Search() {
  const filteredLoans = useLoanStore((s) => s.filteredLoans)
  const downloading = useLoanStore((s) => s.downloading)
  const secondaryStatus = useLoanStore((s) => s.secondaryStatus)
  const backgroundResyncState = useLoanStore((s) => s.backgroundResyncState)
  const loanCount = filteredLoans.length
  const totalFundraising = useLoanStore((s) => s.loanCount)
  const selectedId = useLoanStore((s) => s.selectedId)
  const hasLenderId = Boolean(useUtilsStore((s) => s.lenderId))

  const [showCriteria, setShowCriteria] = useState(true)
  const [hasHadLoans, setHasHadLoans] = useState(false)
  const [showBulkAdd, setShowBulkAdd] = useState(false)

  // Track whether we ever had results
  if (loanCount > 0 && !hasHadLoans) {
    setHasHadLoans(true)
  }

  const toggleCriteria = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setShowCriteria((v) => !v)
    },
    [],
  )

  const openBulkAdd = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setShowBulkAdd(true)
    },
    [],
  )

  // Column widths based on what's visible
  const critCol = showCriteria ? 3 : 0
  const listCol = showCriteria ? 4 : 5
  const detailCol = selectedId ? (showCriteria ? 5 : 7) : (showCriteria ? 5 : 7)

  return (
    <Container fluid className="px-2">
      {showBulkAdd ? <BulkAddModal onHide={() => setShowBulkAdd(false)} /> : null}
      <Row>
        {/* Criteria panel */}
        {showCriteria && (
          <Col md={critCol} style={{ overflowY: 'auto', overflowX: 'hidden', maxHeight: 'calc(100vh - 60px)', paddingRight: 5 }}>
            <Criteria />
          </Col>
        )}

        {/* Loan list */}
        <Col md={listCol} style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 60px)' }}>
          <LoadingLoansPanel />
          <ButtonGroup className="mb-2 mt-1 d-flex w-100">
            <Button variant="outline-secondary" size="sm" onClick={toggleCriteria} className="w-50">
              {showCriteria ? 'Hide Criteria' : 'Show Criteria'}
            </Button>
            <Button variant="outline-secondary" size="sm" onClick={openBulkAdd} className="w-50">
              Bulk Add
            </Button>
          </ButtonGroup>

          {secondaryStatus ? (
            <Alert variant="warning" className="mb-1 py-1" style={{ fontSize: 12 }}>
              More loans are still loading. Carry on. {secondaryStatus}
            </Alert>
          ) : null}

          {backgroundResyncState === 'started' ? (
            <Alert variant="info" className="mb-1 py-1" style={{ fontSize: 12 }}>
              Continue using the site while the loans are refreshed...
            </Alert>
          ) : null}

          {loanCount > 0 ? (
            <div className="loan-count-bar p-1 bg-light border-bottom mb-1" style={{ fontSize: 12 }}>
              Showing {numeral(loanCount).format('0,0')} of{' '}
              {numeral(totalFundraising).format('0,0')} fundraising loans
            </div>
          ) : null}

          {hasHadLoans && loanCount === 0 && !downloading ? (
            <Alert variant="info" className="py-2">
              No matching loans. Loosen the criteria or click &quot;Reset&quot;.
            </Alert>
          ) : null}

          {downloading && loanCount === 0 ? (
            <Alert variant="secondary" className="py-2">Loading loans...</Alert>
          ) : null}

          <ListGroup variant="flush">
            {filteredLoans.slice(0, 200).map((loan) => (
              <LoanListItem key={loan.id} loan={loan} />
            ))}
          </ListGroup>
        </Col>

        {/* Loan detail panel / Welcome panel */}
        <Col md={detailCol} style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 60px)', borderLeft: '1px solid #ddd' }}>
          {selectedId ? (
            <Loan loanId={selectedId} />
          ) : (
            <div className="p-3">
              <h4>Welcome to KivaLens</h4>
              <p>
                Search for loans using the criteria on the left, then click a loan to
                see its details here.
              </p>
              <ul style={{ paddingLeft: 18 }}>
                <li>Click a loan to view details and repayment schedule</li>
                <li>Double-click a loan to add it to your basket</li>
                <li>Use &quot;Bulk Add&quot; to add many loans at once</li>
                <li>Save your favorite filters with &quot;Saved Searches&quot;</li>
              </ul>
              {!hasLenderId ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: '12px 16px',
                    background: '#f0f8f4',
                    borderRadius: 6,
                    border: '1px solid #d4edda',
                  }}
                >
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      showLenderIDModal()
                    }}
                  >
                    Set your Lender ID
                  </a>{' '}
                  to hide loans you&apos;ve already funded and enable portfolio balancing.
                </div>
              ) : null}
              <hr />
              <DidYouKnow />
            </div>
          )}
        </Col>
      </Row>
    </Container>
  )
}

export default Search
