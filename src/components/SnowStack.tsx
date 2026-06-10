import { useState, useEffect, useMemo } from 'react'
import { Container } from 'react-bootstrap'
import { useLoanStore } from '../stores'
import type { KivaLoan } from '../types'

interface ImageCard {
  id: number
  thumb: string
  link: string
  name: string
}

function loanToCard(loan: KivaLoan): ImageCard {
  const imageId = loan.image.id
  return {
    id: loan.id,
    thumb: `https://www.kiva.org/img/w480/${imageId}.jpg`,
    link: `https://www.kiva.org/lend/${loan.id}`,
    name: loan.name,
  }
}

/**
 * SnowStack - A grid gallery of loan images.
 *
 * The original component used a 3D WebGL-based "snowstack" effect.
 * This modernized version renders a responsive image grid with hover effects
 * and links to the loan pages on Kiva.
 */
export function Component() {
  const loans = useLoanStore((s) => s.loans)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loans.length > 0) {
      setLoaded(true)
    }
  }, [loans])

  const images = useMemo(() => {
    if (loans.length === 0) return []

    // Gather interesting and popular loans, take up to 200
    const fundraising = loans.filter((l) => l.status === 'fundraising')

    // Sort by a mix: tagged interesting first, then by popularity proxy
    const tagged = fundraising.filter(
      (l) => l.tags?.some((t) => t.name === '#InterestingPhoto'),
    )
    const rest = fundraising
      .filter((l) => !tagged.includes(l))
      .sort((a, b) => (b.funded_amount / (b.loan_amount || 1)) - (a.funded_amount / (a.loan_amount || 1)))

    const combined = [...tagged, ...rest].slice(0, 200)
    return combined.map(loanToCard)
  }, [loans])

  if (!loaded) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ minHeight: 'calc(100vh - 120px)' }}
      >
        <div className="text-center text-muted">
          <div className="spinner-border mb-3" role="status" />
          <div>Loading loan images...</div>
        </div>
      </div>
    )
  }

  return (
    <Container fluid className="py-3" style={{ backgroundColor: '#111', minHeight: 'calc(100vh - 120px)' }}>
      <div className="text-center text-light mb-3">
        <small>
          Showing {images.length} fundraising loan{images.length !== 1 ? 's' : ''}. Click an
          image to view on Kiva.
        </small>
      </div>
      <div
        className="d-flex flex-wrap justify-content-center gap-2"
        style={{ maxWidth: 1400, margin: '0 auto' }}
      >
        {images.map((img) => (
          <a
            key={img.id}
            href={img.link}
            target="_blank"
            rel="noopener noreferrer"
            title={img.name}
            className="snowstack-card"
            style={{
              display: 'block',
              width: 160,
              height: 160,
              borderRadius: 6,
              overflow: 'hidden',
              position: 'relative',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)'
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(255,255,255,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <img
              src={img.thumb}
              alt={img.name}
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '4px 6px',
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {img.name}
            </div>
          </a>
        ))}
      </div>
    </Container>
  )
}
