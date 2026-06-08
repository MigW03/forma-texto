import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import { useAuth } from '../lib/auth-context'

// The guard's only dependency is the auth context; mock it so each test can
// drive the loading / signed-out / signed-in states directly.
vi.mock('../lib/auth-context', () => ({ useAuth: vi.fn() }))
const mockedUseAuth = vi.mocked(useAuth)

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route
          path="/secret"
          element={
            <ProtectedRoute>
              <div>secret content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/sign-in" element={<div>sign in page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders children when a user is signed in', () => {
    mockedUseAuth.mockReturnValue({ user: { id: 'u1' }, loading: false } as ReturnType<typeof useAuth>)
    renderGuarded()
    expect(screen.getByText('secret content')).toBeInTheDocument()
    expect(screen.queryByText('sign in page')).not.toBeInTheDocument()
  })

  it('redirects to sign-in when there is no user', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as ReturnType<typeof useAuth>)
    renderGuarded()
    expect(screen.getByText('sign in page')).toBeInTheDocument()
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })

  it('shows neither content nor a redirect while loading', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: true } as ReturnType<typeof useAuth>)
    renderGuarded()
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
    expect(screen.queryByText('sign in page')).not.toBeInTheDocument()
  })
})
