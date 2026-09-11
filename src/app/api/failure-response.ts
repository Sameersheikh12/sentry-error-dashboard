import { describeFailure } from '@/lib/failure'

export function failureResponse(error: unknown): Response {
  const { error: body, httpStatus } = describeFailure(error)

  const headers = new Headers({ 'cache-control': 'no-store' })
  if (body.retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(body.retryAfterSeconds))
  }

  return Response.json({ error: body }, { status: httpStatus, headers })
}
