import { assertServerSafety } from '@/lib/config/guard'

export function register() {
  assertServerSafety()
}
