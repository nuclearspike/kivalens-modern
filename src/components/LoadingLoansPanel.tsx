import { useMemo } from 'react'
import { Card, ProgressBar } from '../ui'
import { useLoanStore } from '../stores'

/**
 * Overlay panel shown while fundraising loans are being downloaded from Kiva.
 * Displays a segmented progress bar and status label.
 */
export default function LoadingLoansPanel() {
  const downloading = useLoanStore((s) => s.downloading)
  const progress = useLoanStore((s) => s.downloadProgress)

  const state = useMemo(() => {
    const idsProgress = progress?.task === 'ids' && progress.done != null && progress.total
      ? (progress.done * 100) / progress.total * (progress.singlePass ? 1 : 0.33)
      : progress?.singlePass
        ? 0
        : 33
    const detailsProgress = progress?.task !== 'ids' && progress?.done != null && progress.total
      ? (progress.done * 100) / progress.total * (progress.singlePass ? 1 : 0.67)
      : 0

    return {
      show: downloading && !progress?.complete,
      title: progress?.title ?? 'Loading Fundraising Loans from Kiva.org',
      progressLabel: progress?.label ?? 'Please Wait...',
      idsProgress,
      detailsProgress,
    }
  }, [downloading, progress])

  if (!state.show) return null

  return (
    <Card className="border-0 rounded-0">
      <Card.Header>
        <Card.Title>{state.title}</Card.Title>
      </Card.Header>
      <Card.Body>
        <ProgressBar>
          <ProgressBar
            variant="info"
            animated={state.idsProgress < 32}
            label={state.idsProgress > 10 ? 'basics' : ''}
            now={state.idsProgress}
            key="ids"
          />
          <ProgressBar
            animated
            label={state.detailsProgress > 10 ? 'details' : ''}
            now={state.detailsProgress}
            key="details"
          />
        </ProgressBar>
      </Card.Body>
      <Card.Footer>
        {state.progressLabel}
      </Card.Footer>
    </Card>
  )
}
